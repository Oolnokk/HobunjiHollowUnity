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
      const dodgeBtn = document.getElementById('dodgeBtn');
      const btnSwapTarget = document.getElementById('btnSwapTarget');
      const btnWeaponSwitch = document.getElementById('btnWeaponSwitch');
      const btnWeaponSwitchIcon = document.getElementById('btnWeaponSwitchIcon');

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
        buildEquipmentSlots();
        if (targetPanel === 'shipping') buildShippingTransferUI();
        if (targetPanel === 'supplies') renderSupplyPage();
        if (targetPanel === 'generalStore') renderGeneralStorePage();
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
        if (id === 'inventory') { buildInventoryGrid(); buildEquipmentSlots(); }
        if (id === 'shipping') buildShippingTransferUI();
        if (id === 'supplies') renderSupplyPage();
        if (id === 'generalStore') renderGeneralStorePage();
        if (id === 'debug' && window._renderDebugPanel) window._renderDebugPanel();
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
      // Debug log copy-to-clipboard button
      const _dbgCopy = document.getElementById('debugCopyBtn');
      if (_dbgCopy) _dbgCopy.addEventListener('click', () => copyDebugLog());
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

      function gameAudioConfig() {
        const direct = window.SCRATCHBONES_CONFIG?.game?.audio;
        if (direct && Object.keys(direct).length) return direct;
        return window.SCRATCHBONES_CONFIG?.game?.assets?.audio || {};
      }

      // ── NPC Dialogue ───────────────────────────────────────────
      const _npcDialogueEl      = document.getElementById('npcDialogue');
      const _npcPortraitCanvas  = document.getElementById('npcPortraitCanvas');
      const _npcDialogueNameEl  = document.getElementById('npcDialogueName');
      const _npcDialogueTextEl  = document.getElementById('npcDialogueText');
      const _npcDialogueHeartsEl = document.getElementById('npcDialogueHearts');
      const _arcContainerEl     = document.getElementById('arcContainer');

      function npcDialogueTextConfig() {
        return window.SCRATCHBONES_CONFIG?.game?.npcDialogue?.text || {};
      }

      function npcDialogueLetterSfxConfig(rec = _dlgNpcRec || _dialogueWalker?.rec) {
        const audioCfg = gameAudioConfig();
        const dialogueCfg = audioCfg.dialogueLetter || {};
        const npcOverrides = dialogueCfg.npcs || {};
        const speciesOverrides = dialogueCfg.species || {};
        const speciesId = rec?.appearance?.speciesId || rec?.speciesId || rec?.species || _dialogueWalker?.speciesId;
        return {
          ...dialogueCfg,
          ...(speciesId && speciesOverrides[speciesId] ? speciesOverrides[speciesId] : {}),
          ...(rec?.id && npcOverrides[rec.id] ? npcOverrides[rec.id] : {}),
          ...(rec?.dialogueLetterSfx || {})
        };
      }

      function npcDialogueTypewriterConfig() {
        const cfg = npcDialogueTextConfig().typewriter || {};
        return {
          enabled: cfg.enabled !== false,
          msPerChar: Math.max(1, Number(cfg.msPerChar) || 22),
          punctuationPauseMs: Math.max(0, Number(cfg.punctuationPauseMs) || 120),
          whitespacePauseMs: Math.max(0, Number(cfg.whitespacePauseMs) || 0)
        };
      }

      function _paginateNpcDialogueText(text) {
        const cfg = npcDialogueTextConfig();
        const emptyLine = cfg.emptyLine || '...';
        const source = String(text || '').trim();
        if (!source) return [emptyLine];
        const maxChars = Math.max(1, Number(cfg.maxCharsPerPage) || source.length);
        const pages = [];
        let current = '';
        for (const word of source.split(/\s+/)) {
          const next = current ? `${current} ${word}` : word;
          if (next.length > maxChars && current) {
            pages.push(current);
            current = word;
          } else {
            current = next;
          }
        }
        if (current) pages.push(current);
        return pages.length ? pages : [emptyLine];
      }

      function _npcDialogueLines(rec) {
        if (!rec) return _paginateNpcDialogueText('');
        if (Array.isArray(rec.dialogueLines) && rec.dialogueLines.length) {
          return rec.dialogueLines.flatMap(line => _paginateNpcDialogueText(line));
        }
        if (rec.bio) return _paginateNpcDialogueText(rec.bio);
        return _paginateNpcDialogueText('');
      }

      function _getNpcDlgState(npcId) {
        if (!_npcDlgState.has(npcId)) _npcDlgState.set(npcId, { visitedSeqSlots: {}, localNickname: null, favor: 0, memory: [] });
        return _npcDlgState.get(npcId);
      }

      // NPC relationships/memory are world-scoped per character — they stay
      // behind in this world's member record rather than following the
      // character to another world. Loaded into the same _npcDlgState map
      // that already tracked visited dialogue nodes/local nicknames for the
      // current session, so NPCs remember what's been said across sessions too.
      function loadNpcRelationships(playerData) {
        _npcDlgState.clear();
        const rels = playerData?.npcRelationships || {};
        for (const [npcId, rel] of Object.entries(rels)) {
          _npcDlgState.set(npcId, {
            visitedSeqSlots: { ...(rel.visitedSeqSlots || {}) },
            localNickname:   rel.localNickname || null,
            favor:           rel.favor || 0,
            memory:          [...(rel.memory || [])],
          });
        }
      }

      function npcRelationshipsSnapshot() {
        const out = {};
        for (const [npcId, st] of _npcDlgState.entries()) {
          out[npcId] = {
            visitedSeqSlots: st.visitedSeqSlots,
            localNickname:   st.localNickname,
            favor:           st.favor || 0,
            memory:          st.memory || [],
          };
        }
        return out;
      }

      // Appends a small memory entry an NPC "remembers" about this character —
      // ready for gift/dialogue-choice hooks to call into once those systems
      // record specific events, not just that a conversation happened.
      function recordNpcMemory(npcId, event) {
        if (!npcId) return;
        const st = _getNpcDlgState(npcId);
        st.memory.push({ event, day: calendar.day, ts: Date.now() });
        if (st.memory.length > 50) st.memory.shift();
      }

      // No gift/relationship-building system exists yet to call this from —
      // exposed as the entry point that one will use once built.
      function adjustNpcFavor(npcId, amount, reason) {
        if (!npcId) return;
        const st = _getNpcDlgState(npcId);
        st.favor = (st.favor || 0) + amount;
        recordNpcMemory(npcId, reason || (amount >= 0 ? 'favor_up' : 'favor_down'));
      }

      function _resolveTokens(text, npcRec) {
        if (!text) return '';
        const p     = _playerData;
        const name  = p?.nickname || 'Farmer';
        const gen   = p?.appearance?.gender || 'male';
        const pr1   = gen === 'female' ? 'she'     : gen === 'neutral' ? 'they'    : 'he';
        const pr2   = gen === 'female' ? 'her'     : gen === 'neutral' ? 'them'    : 'him';
        const pr3   = gen === 'female' ? 'her'     : gen === 'neutral' ? 'their'   : 'his';
        const prS   = gen === 'female' ? 'herself' : gen === 'neutral' ? 'themself': 'himself';
        const VOWELS = new Set('aeiouAEIOU');
        let fl2v1 = '';
        for (const ch of name) { fl2v1 += ch; if (VOWELS.has(ch)) break; }
        const st    = _getNpcDlgState(npcRec?.id);
        const local = st.localNickname || name;
        return text
          .replace(/\{\{npcName\}\}/g,            npcRec?.name || '')
          .replace(/\{\{playerName\}\}/g,          name)
          .replace(/\{\{playerNickname\}\}/g,      name)
          .replace(/\{\{playerLocalNickname\}\}/g, local)
          .replace(/\{\{playerPronoun1\}\}/g,      pr1)
          .replace(/\{\{playerPronoun2\}\}/g,      pr2)
          .replace(/\{\{playerPronoun3\}\}/g,      pr3)
          .replace(/\{\{playerPronounSelf\}\}/g,   prS)
          .replace(/\{\{playerFirstL2V1\}\}/g,     fl2v1);
      }

      function _pickDialogueTree(rec) {
        // A tree can tag itself visibility: 'owner' or 'farmhand' to restrict
        // it to the world's protagonist or to non-owner members respectively;
        // omitted/'any' (the default) is visible to everyone.
        const trees = (rec?.dialogueTrees || [])
          .filter(t => (t.trigger || 'interact') === 'interact' && canAccessContent(t.visibility));
        return trees.sort((a, b) => (b.priority || 0) - (a.priority || 0))[0] || null;
      }

      // Shrinks a .dlg-opt-label's font-size (down from the CSS default) until its
      // 3-line-clamped content stops overflowing the option button's allotted height.
      function _fitDlgOptionLabel(el) {
        const label = el.querySelector('.dlg-opt-label');
        if (!label) return;
        const baseSize = 11, minSize = 3;
        let size = baseSize;
        label.style.fontSize = size + 'px';
        // Compare against the label's OWN (3-line-clamped) box height, not the
        // button's — with align-items:center the label never stretches to fill
        // the button, so checking the button's height let overflow through.
        while (size > minSize && label.scrollHeight > label.clientHeight) {
          size -= 1;
          label.style.fontSize = size + 'px';
        }
      }

      function _showDlgChoices(node) {
        const choices = node.choices || [];
        const optEls  = [1,2,3,4,5,6].map(i => document.getElementById(`dlgOpt${i}`));
        optEls.forEach(el => {
          if (!el) return;
          const label = el.querySelector('.dlg-opt-label');
          if (label) { label.textContent = ''; label.style.fontSize = ''; }
          el.classList.remove('dlg-opt-visible');
          el.onclick = null;
        });
        choices.slice(0, 6).forEach((c, i) => {
          const el = optEls[i];
          if (!el) return;
          const label = el.querySelector('.dlg-opt-label');
          if (label) label.textContent = _resolveTokens(c.label || '', _dlgNpcRec);
          el.classList.add('dlg-opt-visible');
          el.onclick = () => {
            if (!dialogueOpen) return;
            let skipNav = false;
            (c.actions || []).forEach(act => {
              if (act.type === 'setLocalNickname') {
                const st = _getNpcDlgState(_dlgNpcRec?.id);
                st.localNickname = _resolveTokens(act.value || '', _dlgNpcRec) || null;
              } else if (act.type === 'openShop') {
                closeNpcDialogue();
                openMenu('generalStore');
                skipNav = true;
              } else if (act.type === 'startChat') {
                _beginNpcConversation(_dlgNpcRec);
                skipNav = true;
              }
            });
            if (!skipNav) _navigateDlgTo(c.next);
          };
        });
        // Run after all options are flagged visible so each one's flex-allotted
        // height (which depends on how many siblings are showing) is settled.
        optEls.forEach(el => { if (el && el.classList.contains('dlg-opt-visible')) _fitDlgOptionLabel(el); });
        const continueBtn = document.getElementById('npcDialogueContinue');
        if (continueBtn) continueBtn.style.display = choices.length ? 'none' : '';
      }

      function _hideChoiceButtons() {
        [1,2,3,4,5,6].forEach(i => {
          const el = document.getElementById(`dlgOpt${i}`);
          if (!el) return;
          const label = el.querySelector('.dlg-opt-label');
          if (label) { label.textContent = ''; label.style.fontSize = ''; }
          el.classList.remove('dlg-opt-visible'); el.onclick = null;
        });
        const continueBtn = document.getElementById('npcDialogueContinue');
        if (continueBtn) continueBtn.style.display = '';
      }

      function npcDialoguePortraitConfig() {
        return window.SCRATCHBONES_CONFIG?.game?.npcDialogue?.portrait || {};
      }

      function _dialogueExpressionDurationMs(node) {
        const holdSeconds = Number(node?.expressionHold);
        if (Number.isFinite(holdSeconds) && holdSeconds > 0) return holdSeconds * 1000;
        return Number(window.SCRATCHBONES_CONFIG?.game?.portrait?.expressions?.durationMs) || 10000;
      }

      function _dialogueSeatId(walker = _dialogueWalker) {
        return walker?.rec?.id || walker?.rec?.name || 'npcDialogue';
      }

      function _playNpcDialogueLetterSfx(char, rec = _dlgNpcRec || _dialogueWalker?.rec) {
        const cfg = npcDialogueLetterSfxConfig(rec);
        if (cfg.enabled === false || !char || /\s/.test(char)) return;
        const audioCfg = gameAudioConfig();
        if (audioCfg.enabled === false) return;
        const volume = Math.max(0, Math.min(1, Number(cfg.volume) || 0.18)) * Math.max(0, Number(audioCfg.sfxVolume) || 1);
        if (volume <= 0) return;
        if (cfg.url) {
          const snd = new Audio(cfg.url);
          snd.volume = volume;
          snd.playbackRate = Math.max(0.25, Number(cfg.playbackRate) || 1);
          snd.play().catch(() => {});
          return;
        }
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = window._npcDialogueAudioCtx || (window._npcDialogueAudioCtx = new AudioCtx());
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const variance = Math.max(0, Number(cfg.frequencyVarianceHz) || 35);
        const base = Math.max(20, Number(cfg.frequencyHz) || 520);
        osc.type = cfg.waveform || 'square';
        osc.frequency.value = base + (Math.random() * 2 - 1) * variance;
        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (Math.max(5, Number(cfg.durationMs) || 24) / 1000));
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + (Math.max(5, Number(cfg.durationMs) || 24) / 1000));
      }

      function _stopNpcDialogueTypewriter(showFullText = false) {
        if (_npcDialogueTypeTimer) clearTimeout(_npcDialogueTypeTimer);
        _npcDialogueTypeTimer = null;
        if (showFullText && _npcDialogueTypeText) _npcDialogueTextEl.textContent = _npcDialogueTypeText;
        _npcDialogueTypeText = '';
        _npcDialogueTypeIndex = 0;
      }

      function _setNpcDialogueText(text, node = null) {
        const resolvedText = String(text || '');
        _stopNpcDialogueTypewriter(false);
        _applyNpcDialogueLinePresentation(resolvedText, node);
        const cfg = npcDialogueTypewriterConfig();
        if (!cfg.enabled) { _npcDialogueTextEl.textContent = resolvedText; return; }
        _npcDialogueTypeText = resolvedText;
        _npcDialogueTypeIndex = 0;
        _npcDialogueTextEl.textContent = '';
        const tick = () => {
          if (!dialogueOpen || !_npcDialogueTypeText) return;
          const char = _npcDialogueTypeText[_npcDialogueTypeIndex++];
          _npcDialogueTextEl.textContent += char;
          _playNpcDialogueLetterSfx(char);
          if (_npcDialogueTypeIndex >= _npcDialogueTypeText.length) { _stopNpcDialogueTypewriter(false); return; }
          const delay = /[.!?,;:]/.test(char) ? cfg.punctuationPauseMs : /\s/.test(char) ? cfg.whitespacePauseMs : cfg.msPerChar;
          _npcDialogueTypeTimer = setTimeout(tick, delay);
        };
        _npcDialogueTypeTimer = setTimeout(tick, cfg.msPerChar);
      }

      function _applyNpcDialogueLinePresentation(text, node = null) {
        if (!window.portraitBreathingComposer) return;
        const seatId = _dialogueSeatId();
        const expression = String(node?.expression || 'neutral').toLowerCase();
        window.portraitBreathingComposer.setDefaultExpression(seatId, expression);
        if (expression && expression !== 'neutral') {
          window.portraitBreathingComposer.setExpression(seatId, expression, _dialogueExpressionDurationMs(node));
        }
        window.portraitBreathingComposer.scheduleYapSequence(seatId, text || '', npcDialoguePortraitConfig().yap || {});
      }

      async function _renderNpcDialoguePortrait() {
        if (!dialogueOpen || !_dialogueWalker?.profile || !window.NpcAvatarPreview) return false;
        const renderOptions = {
          breathingComposer: window.portraitBreathingComposer || null,
          seatId: _dialogueSeatId(),
        };
        await window.NpcAvatarPreview.renderProfileToCanvas(_npcPortraitCanvas, _dialogueWalker.profile, renderOptions);
        if (_dialogueWalker.avatarFrontCanvas && window.PNGPlaneAvatar?.refreshSinglePlaneAvatarModel) {
          await window.NpcAvatarPreview.renderProfileToCanvas(_dialogueWalker.avatarFrontCanvas, _dialogueWalker.profile, renderOptions);
          window.PNGPlaneAvatar.refreshSinglePlaneAvatarModel(_dialogueWalker.avatarGroup, _dialogueWalker.avatarFrontCanvas);
        }
        return true;
      }

      let _npcDialoguePortraitRenderPending = false;
      let _npcDialoguePortraitLastRenderMs = 0;
      function updateNpcDialoguePortrait(nowMs = performance.now()) {
        if (!dialogueOpen || !_dialogueWalker?.profile || _npcDialoguePortraitRenderPending) return;
        const fps = Math.max(1, Number(npcDialoguePortraitConfig().maxFps) || 12);
        if (nowMs !== 0 && nowMs - _npcDialoguePortraitLastRenderMs < 1000 / fps) return;
        _npcDialoguePortraitRenderPending = true;
        _renderNpcDialoguePortrait()
          .catch(err => console.warn('[npc-dialogue] portrait render failed', err))
          .finally(() => {
            _npcDialoguePortraitLastRenderMs = performance.now();
            _npcDialoguePortraitRenderPending = false;
          });
      }

      function _renderDlgNode(node) {
        if (!node) { closeNpcDialogue(); return; }
        _dlgNode = node;

        if (node.type === 'end') { closeNpcDialogue(); return; }

        if (node.type === 'sequence') { _handleSequenceNode(node); return; }

        const text = _resolveTokens(node.text || '', _dlgNpcRec);
        _setNpcDialogueText(text, node);
        updateNpcDialoguePortrait(0);

        if (node.type === 'choice') {
          _showDlgChoices(node);
        } else {
          _hideChoiceButtons();
        }
      }

      function _handleSequenceNode(seqNode) {
        const st       = _getNpcDlgState(_dlgNpcRec?.id);
        const visited  = st.visitedSeqSlots[seqNode.id] || [];
        const slots    = seqNode.slots || [];
        const nextIdx  = slots.findIndex((_, i) => !visited.includes(i));

        if (nextIdx === -1) {
          // All slots exhausted
          _navigateDlgTo(seqNode.exhaustedNext);
          return;
        }

        const slot = slots[nextIdx];
        st.visitedSeqSlots[seqNode.id] = [...visited, nextIdx];
        _dlgSeqStack.push({ seqNodeId: seqNode.id, seqNode, depthRemaining: slot.depth });
        _navigateDlgTo(slot.nodeId);
      }

      function _navigateDlgTo(nodeId) {
        if (!nodeId) {
          // End of chain — pop sequence stack if any, otherwise end dialogue
          if (_dlgSeqStack.length > 0) {
            const frame = _dlgSeqStack.pop();
            _navigateDlgTo(frame.seqNode.next || null);
          } else {
            closeNpcDialogue();
          }
          return;
        }
        const node = _dlgNodeMap?.[nodeId];
        if (!node) { closeNpcDialogue(); return; }
        _renderDlgNode(node);
      }

      function _advanceDlgNode() {
        if (!_dlgNode) return;
        if (_dlgNode.type === 'choice') return; // choices require clicking an option button
        const next = _dlgNode.next;
        if (_dlgSeqStack.length > 0) {
          const frame = _dlgSeqStack[_dlgSeqStack.length - 1];
          if (frame.depthRemaining <= 0) {
            _dlgSeqStack.pop();
            _navigateDlgTo(frame.seqNode.next || null);
            return;
          }
          frame.depthRemaining--;
        }
        _navigateDlgTo(next || null);
      }

      // Starts the actual conversation content (dialogue tree, or the plain
      // bio/line fallback) — shared by plain NPCs and by the "Chat" branch
      // of the merchant shop/chat choice below.
      function _beginNpcConversation(rec) {
        const tree = _pickDialogueTree(rec);
        if (tree) {
          _dlgTree    = tree;
          _dlgNodeMap = Object.fromEntries((tree.nodes || []).map(n => [n.id, n]));
          _dlgNpcRec  = rec;
          _dlgSeqStack = [];
          _dialogueLines   = [];
          _dialogueLineIdx = 0;
          _navigateDlgTo(tree.entryNode);
        } else {
          _dlgTree = null; _dlgNodeMap = null; _dlgNode = null; _dlgNpcRec = rec;
          _hideChoiceButtons();
          _dialogueLines   = _npcDialogueLines(rec);
          _dialogueLineIdx = 0;
          _setNpcDialogueText(_dialogueLines[0]);
          updateNpcDialoguePortrait(0);
        }
      }

      async function openNpcDialogue(walker) {
        const rec  = walker.rec;
        recordNpcMemory(rec?.id, 'talked');

        dialogueOpen    = true;
        _dialogueWalker = walker;
        activeCameraMode   = npcDialogueCameraMode();
        activeCameraTarget = walker.root;
        beginNpcDialogueStaging(walker);
        updateDialogueZoomIndicator();
        walker.pause = Infinity;
        _npcDialogueNameEl.textContent = rec?.name || 'Stranger';
        if (_npcDialogueHeartsEl) _npcDialogueHeartsEl.textContent = renderRelationshipHearts(rec);
        _arcContainerEl?.classList.add('arc-hidden');

        if (walker.profile && window.NpcAvatarPreview) {
          const ctx = _npcPortraitCanvas.getContext('2d');
          ctx.fillStyle = '#1b3529';
          ctx.fillRect(0, 0, _npcPortraitCanvas.width, _npcPortraitCanvas.height);
          await _renderNpcDialoguePortrait();
        }

        _npcDialogueEl.classList.add('open');
        _npcDialogueEl.setAttribute('aria-hidden', 'false');

        if (isGeneralStoreNpcOnDuty(walker)) {
          const cfg = generalStoreButtonConfig();
          _dlgNpcRec = rec; _dlgTree = null; _dlgNodeMap = null; _dlgSeqStack = [];
          _renderDlgNode({
            type: 'choice',
            text: cfg.shopGreeting || 'What can I do for you?',
            choices: [
              { label: cfg.buyChoiceLabel || 'Buy', actions: [{ type: 'openShop' }] },
              { label: cfg.chatChoiceLabel || 'Chat', actions: [{ type: 'startChat' }] },
            ],
          });
          return;
        }

        _beginNpcConversation(rec);
      }

      function advanceNpcDialogue() {
        if (_npcDialogueTypeText) { _stopNpcDialogueTypewriter(true); return; }
        if (_dlgTree) { _advanceDlgNode(); return; }
        _dialogueLineIdx++;
        if (_dialogueLineIdx >= _dialogueLines.length) { closeNpcDialogue(); return; }
        _setNpcDialogueText(_dialogueLines[_dialogueLineIdx]);
        updateNpcDialoguePortrait(0);
      }

      function closeNpcDialogue() {
        dialogueOpen = false;
        _dialogueLines = [];
        _dialogueLineIdx = 0;
        _dlgTree = null; _dlgNodeMap = null; _dlgNode = null; _dlgNpcRec = null; _dlgSeqStack = [];
        _stopNpcDialogueTypewriter(false);
        _hideChoiceButtons();
        npcDialogueStaging = null;
        window.portraitBreathingComposer?.setExpression(_dialogueSeatId(), 'neutral');
        window.portraitBreathingComposer?.setDefaultExpression(_dialogueSeatId(), 'neutral');
        if (_dialogueWalker) {
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

      function renderRelationshipHearts(rec) {
        const score = rec?.relationship ?? null;
        if (score === null) return '';
        const clamped = Math.max(-5, Math.min(10, score));
        const hearts = [];
        for (let i = -5; i <= 10; i++) {
          if (i === 0) continue;
          if (clamped < 0) {
            hearts.push(i < 0 && i >= clamped ? '💜' : i < 0 ? '🖤' : '🤍');
          } else {
            hearts.push(i <= clamped ? '❤️' : i > 0 ? '🤍' : '');
          }
        }
        return hearts.filter(Boolean).join('');
      }

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
      const ACCEL         = 980;  // px/s²; used by updateMovement() for snappier starts.
      const TURN_ACCEL    = 1320; // px/s²; used when input reverses or sharply turns.
      const DECEL         = 1850; // px/s²; used by updateMovement() to avoid floaty stops.
      const CARDINAL_BIAS = 0.18; // used by updateMovement(); lower keeps diagonals less sticky.
      const JOYSTICK_RADIUS = 56; // Fallback radius; updateJoystick() scales to the current viewport-anchored joystick size.
      const JOYSTICK_DEADZONE = 0.14; // used by updateJoystick() to prevent thumb drift near center.
      const JOYSTICK_RESPONSE = 0.82; // used by updateJoystick() to make small thumb motion feel responsive.
      const ACTION_FX_LIMIT = 90; // used by spawnActionParticles()/updateActionParticles() to cap mobile effects.
      const FLOW_SOURCE_ROW = 0;
      const DAY_LENGTH_SECONDS = 288; // 4x the original 72s — time now runs at 25% speed
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
      // Interior dimensions — 12×12 (doubled from original 6×6).
      // Layout: 12×10 main room (cols 0-11, rows 0-9) + 4-cell wide south corridor (cols 4-7, rows 10-11)
      const INTERIOR_COLS        = 12;
      const INTERIOR_ROWS        = 12;
      const INTERIOR_ENTRY_COL   = 5;    // player spawns here when entering (center corridor col)
      const INTERIOR_ENTRY_ROW   = 9;    // just inside the main room, north of the corridor
      const INTERIOR_EXIT_COL    = 5;    // center col of south exit corridor
      const INTERIOR_EXIT_ROW    = 11;   // last row of south exit corridor
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
        [TileType.PATH]:   0.006, // hard-packed surface drains slowly
      };
      const EVAP_RATE    = 0.002;  // evapotranspiration — drains all tiles slowly even when dry
      const FLOW_RATE         = 0.45;  // fraction of head difference transferred per tick
      const TRENCH_FLOW_BONUS = 3.0;   // trenches pull water from neighbours faster (scaled by tile.depth)
      // Rain gradually silts trenches back in — depth drains while raining and the
      // trench reverts to grass once fully filled. Redigging (single tap) restores depth to 1.
      const TRENCH_SILT_RATE  = 0.0006;  // depth lost per sim tick, per unit rain strength

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
        axe:     ['chop', 'hack'],
        pick:    ['dig', 'raise', 'fill'],
        harpoon: ['fish'],
        weapon:  ['cut', 'slash'],
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
        harvest:    ['🧺', 'Harvest'],
        fish:       ['🎣', 'Fish'],
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

      // ── Footstep SFX ──────────────────────────────────────────────────
      // Placeholder footfalls, keyed by a coarse "surface" rather than raw
      // TileType — several tile types share a footstep (e.g. grass and weeds
      // both sound like grass underfoot). Interior floors always map to
      // 'wood' regardless of the (irrelevant) tile type beneath them.
      //
      // Every surface reuses the exact same oscillator+noise voice (the only
      // one of our synth attempts that reads as a footstep rather than a
      // sound effect) — they're differentiated purely by post effects
      // (filter shape/cutoff/Q, pitch, decay length), not a different recipe.
      const FOOTSTEP_BASE = Object.freeze({
        waveform: 'triangle', freq: 55, freqVarianceHz: 16, durationMs: 55, noiseMix: 0.82, volume: 0.26,
      });

      // Swap in real recordings later by setting `url` on a surface's post-fx
      // entry, same convention as _playNpcDialogueLetterSfx's cfg.url.
      const FOOTSTEP_POST_FX = Object.freeze({
        grass: {},
        dirt:  { filterFreqMul: 2.4, filterQ: 1.2, durationMul: 1.15 },
        path:  { filterFreqMul: 4.6, filterQ: 2.4, durationMul: 0.6,  pitchMul: 1.2,  volumeMul: 0.9 },
        mud:   { filterFreqMul: 1.5, filterQ: 0.9, durationMul: 1.8,  pitchMul: 0.7,  volumeMul: 1.1 },
        water: { filterFreqMul: 5.5, filterQ: 1.0, durationMul: 1.3,  pitchMul: 1.7,  volumeMul: 1.0, filterType: 'highpass' },
        rock:  { filterFreqMul: 5.2, filterQ: 2.8, durationMul: 0.5,  pitchMul: 1.35, volumeMul: 0.95 },
        wood:  { filterFreqMul: 3.6, filterQ: 1.8, durationMul: 0.75, pitchMul: 1.1,  volumeMul: 0.9 },
      });

      // Distance an entity must travel between alternating footfalls, in world px
      // (TILE-scaled so the same constant works for player/creature px coords
      // and NPC tile-unit coords once converted to px).
      const FOOTSTEP_STRIDE_PX = TILE * 0.45;
      // The player moves much faster (px/s) than NPCs/creatures, so the same
      // per-distance stride would trigger footsteps far more often in real
      // time than it does for them — use a longer player-only stride so the
      // cadence (not the tone) matches how often NPC footsteps land.
      const FOOTSTEP_PLAYER_STRIDE_PX = TILE * 1.35;
      // Beyond this distance from the player, NPC/creature footsteps are inaudible.
      const FOOTSTEP_EARSHOT_PX = TILE * 9;
      // NPC/enemy footsteps pan hard left/right within this distance — keeps
      // them clearly directional without needing real spatial audio.
      const FOOTSTEP_PAN_RANGE_PX = TILE * 5;
      // The player and whistled companion animals tread much more quietly
      // than NPCs/hostiles, and aren't panned (the player is the listener;
      // a companion is always close at hand).
      const FOOTSTEP_QUIET_SCALE = 0.35;

      function footstepSurfaceKey(area, type) {
        if (area === 'interior' || _isBuildingArea(area)) return 'wood';
        switch (type) {
          case TileType.PADDY:
          case TileType.RIVER:
          case TileType.STREAM:  return 'water';
          case TileType.TILLED:
          case TileType.RAISED:  return 'dirt';
          case TileType.PATH:    return 'path';
          case TileType.TRENCH:  return 'mud';
          case TileType.ROCK:
          case TileType.SHRUB:   return 'rock';
          default:               return 'grass'; // GRASS, WEEDS
        }
      }

      // Returns the TileType at a world-px coordinate within `area`'s own grid
      // (not necessarily the player's currentArea — used for NPCs/creatures
      // walking around in areas the player isn't currently viewing).
      function footstepTileTypeAt(area, wx, wy, grid) {
        const g = grid || npcGridForArea(area);
        if (!g) return null;
        const col = Math.floor(wx / TILE), row = Math.floor(wy / TILE);
        return g[row]?.[col]?.type ?? null;
      }

      // Advances a per-entity footstep stride accumulator; returns true (and
      // resets the remainder) exactly when a footfall should sound, so cadence
      // naturally scales with how fast the entity is actually moving.
      function _footstepAdvance(state, distPx, stridePx = FOOTSTEP_STRIDE_PX) {
        if (!(distPx > 0)) return false;
        state.footstepAccum = (state.footstepAccum || 0) + distPx;
        if (state.footstepAccum < stridePx) return false;
        state.footstepAccum -= stridePx;
        state.footstepFoot = !state.footstepFoot;
        return true;
      }

      // `pan` is -1 (full left) .. 1 (full right); leave at 0 for the player
      // (the listener) and companions (always close, not worth panning).
      function playFootstepSfx(area, type, volumeScale = 1, pan = 0) {
        const audioCfg = gameAudioConfig();
        if (audioCfg.enabled === false) return;
        const footstepCfg = audioCfg.footsteps || {};
        if (footstepCfg.enabled === false) return;
        const surfaceKey = footstepSurfaceKey(area, type);
        const postFx = { ...FOOTSTEP_POST_FX[surfaceKey], ...(footstepCfg.surfaces?.[surfaceKey] || {}) };
        const base = FOOTSTEP_BASE;
        const baseVolume = Math.max(0, Math.min(1, Number(footstepCfg.volume) || 0.65));
        const volume = baseVolume * Math.max(0, Number(audioCfg.sfxVolume) || 1)
          * Math.max(0, volumeScale) * Math.max(0, Number(base.volume) || 0.26)
          * Math.max(0, Number(postFx.volumeMul) || 1);
        if (volume <= 0.002) return;

        if (postFx.url) {
          const snd = new Audio(postFx.url);
          snd.volume = Math.min(1, volume);
          snd.playbackRate = 0.92 + Math.random() * 0.16;
          snd.play().catch(() => {});
          return;
        }

        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = window._footstepAudioCtx || (window._footstepAudioCtx = new AudioCtx());
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const now = ctx.currentTime;
        const pitchMul = Number(postFx.pitchMul) || 1;
        const durationS = Math.max(0.02, (Number(base.durationMs) || 55) / 1000 * (Number(postFx.durationMul) || 1));
        const noiseMix = Math.max(0, Math.min(1, Number(base.noiseMix) ?? 0.82));
        const baseFreq = Math.max(20, Number(base.freq) * pitchMul);
        const variance = Math.max(0, Number(base.freqVarianceHz) || 15);

        const panNode = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
        if (panNode) {
          panNode.pan.value = Math.max(-1, Math.min(1, pan));
          panNode.connect(ctx.destination);
        }
        const outNode = panNode || ctx.destination;

        if (noiseMix < 1) {
          const osc = ctx.createOscillator();
          const oscGain = ctx.createGain();
          osc.type = base.waveform || 'triangle';
          osc.frequency.value = baseFreq + (Math.random() * 2 - 1) * variance;
          oscGain.gain.setValueAtTime(volume * (1 - noiseMix), now);
          oscGain.gain.exponentialRampToValueAtTime(0.0008, now + durationS);
          osc.connect(oscGain).connect(outNode);
          osc.start(now);
          osc.stop(now + durationS);
        }

        if (noiseMix > 0) {
          const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * durationS));
          const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
          const noise = ctx.createBufferSource();
          noise.buffer = buffer;
          const filter = ctx.createBiquadFilter();
          filter.type = postFx.filterType || 'bandpass';
          filter.frequency.value = baseFreq * (Number(postFx.filterFreqMul) || 3.2);
          filter.Q.value = Number(postFx.filterQ) || 1.6;
          const noiseGain = ctx.createGain();
          noiseGain.gain.setValueAtTime(volume * noiseMix, now);
          noiseGain.gain.exponentialRampToValueAtTime(0.0008, now + durationS);
          noise.connect(filter).connect(noiseGain).connect(outNode);
          noise.start(now);
          noise.stop(now + durationS);
        }
      }

      function combatSfxConfig() { return gameAudioConfig().combatSfx || {}; }

      // One-shot combat SFX player (weapon slash / creature bark / claw hit) —
      // simpler than playFootstepSfx since these always have a real audio
      // file staged (no procedural WebAudio fallback needed).
      function playOneShotSfx(cfgEntry, volumeScale = 1, pitch = 1) {
        const audioCfg = gameAudioConfig();
        if (audioCfg.enabled === false || !cfgEntry?.url) return;
        if (combatSfxConfig().enabled === false) return;
        const volume = Math.max(0, Math.min(1, Number(cfgEntry.volume) || 0.8))
          * Math.max(0, Number(audioCfg.sfxVolume) || 1) * Math.max(0, volumeScale);
        if (volume <= 0.002) return;
        const snd = new Audio(cfgEntry.url);
        snd.volume = Math.min(1, volume);
        const pitchVariance = Number(cfgEntry.pitchVarianceMul) || 0;
        snd.playbackRate = Math.max(0.3, pitch * (1 + (Math.random() * 2 - 1) * pitchVariance));
        snd.play().catch(() => {});
      }

      // Distance falloff for a creature-originated combat sound (bark/claw
      // hit), mirroring tickCreatureFootsteps — inaudible past earshot.
      function playCreatureSfxAt(c, cfgEntry, pitch) {
        if (!cfgEntry || c.areaId !== currentArea) return;
        const distToPlayer = Math.hypot(c.x - player.x, c.y - player.y);
        if (distToPlayer > FOOTSTEP_EARSHOT_PX) return;
        const falloff = Math.pow(Math.max(0, 1 - distToPlayer / FOOTSTEP_EARSHOT_PX), 2);
        playOneShotSfx(cfgEntry, falloff, pitch);
      }

      // Species-keyed pitch lets every creature reuse the same bark asset
      // (only one exists today) while still sounding distinct — alpha
      // gar-wolf pitched down, dabinggi-hound pitched up, relative to the
      // plain gar-wolf's neutral pitch. Future creatures/attacks can add
      // their own url+species entry without touching this function.
      function playCreatureBark(c) {
        const cfg = combatSfxConfig().creatureBark;
        playCreatureSfxAt(c, cfg, Number(cfg?.species?.[c.creatureKey]?.pitch) || 1);
      }

      function playCreatureClawHit(c) {
        playCreatureSfxAt(c, combatSfxConfig().creatureClawHit, 1);
      }

      function playWeaponSlashSfx() {
        playOneShotSfx(combatSfxConfig().weaponSlash, 1, 1);
      }

      // Helper: floor Z for a tile type. Trenches shallow out toward 0 as they silt up.
      function floorZ(type, depth = 1) {
        if (type === TileType.RAISED) return  1;
        if (type === TileType.TRENCH) return -clamp(depth, 0, 1);
        return 0;  // ROCK, SHRUB, and all normal tiles sit at Z=0
      }
      // Max water a tile can hold — trenches scale down with depth as they silt in.
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
        // Cliff climbing — see startClimb()/updateMovement. A scripted crossing
        // (no stamina cost, no terrain collision) rendered as a chain of
        // staggered hops rather than a continuous slide; climbSurfaceY/
        // climbHopBounce are consumed by updatePlayerMesh for the vertical rise.
        climbing: false, climbElapsed: 0, climbHopCount: 0,
        climbStartX: 0, climbStartY: 0, climbEndX: 0, climbEndY: 0,
        climbSurfaceStartY: 0, climbSurfaceEndY: 0, climbSurfaceY: 0, climbHopBounce: 0,
      };

      // Combat tuning is config-backed so tool hit cones, stamina costs, trails,
      // and combat reticles can be tuned without changing code.
      function combatConfig() {
        return window.SCRATCHBONES_CONFIG?.game?.combat || {};
      }
      function weaponAbility(action) {
        const cfg = combatConfig().weaponAbilities?.[action];
        if (!cfg) return null;
        return {
          damage: Number(cfg.damage) || 0,
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
        // Getting hit always interrupts an in-progress combat lunge — without
        // this, resuming the lunge after knockback would interpolate from its
        // stale pre-knockback lungeStartX/Y and jump the player backward.
        if (target.lunging) { target.lunging = false; target.lungeHopCurrent = 0; }
      }

      const PLAYER_STAMINA_REGEN = 14;   // per second
      const PLAYER_HEALTH_REGEN  = 1.2;  // per second, passive
      const DODGE_DUR_S = 0.22;
      const DODGE_SPEED_PX = 640;
      const DODGE_IFRAME_MS = 380;
      const DODGE_COOLDOWN_S = 0.6;
      const DODGE_STAMINA_COST = 18;

      // Global creature database — companions (whistle-bound) and hostiles
      // (ambient-spawned) are both built from this table.
      // canClimb/canSwim: default false — a creature without the tag can't
      // enter an incline (cliff wall) or river/stream tile at all, in either
      // direction (up, down, or straight across). See moveCreatureToward.
      const CREATURE_DB = {
        'dabinggi-hound': {
          label: 'Dabinggi-hound', hostile: false,
          maxHealth: 50, maxStamina: 40,
          moveSpeed: 165, chaseSpeed: 220,
          attackDamage: 10, attackRangePx: TILE * 0.9, attackHalfConeRad: 45 * Math.PI / 180,
          attackStaminaCost: 14, attackCooldownS: 1.1,
          attacks: ['pounce'],
          canClimb: false, canSwim: false,
          modelWidth: 1.9, tint: 0xffffff,
          sprites: {
            idle: 'assets/creaturesprites/dabinggi-hound_idle.png',
            run: ['assets/creaturesprites/dabinggi-hound_run1.png', 'assets/creaturesprites/dabinggi-hound_run2.png'],
          },
          loot: [
            { key: 'dabinggiHoundMeat', min: 1, max: 3 },
            { key: 'dabinggiHoundHide', min: 1, max: 1 },
          ],
        },
        'gar-wolf': {
          label: 'Gar-wolf', hostile: true,
          maxHealth: 38, maxStamina: 30,
          moveSpeed: 130, chaseSpeed: 195,
          attackDamage: 12, attackRangePx: TILE * 0.85, attackHalfConeRad: 42 * Math.PI / 180,
          attackStaminaCost: 12, attackCooldownS: 1.0,
          attacks: ['pounce'],
          // Slottable AI behavior-stage cycle (see updateCreatureBehaviorStage):
          // try a Pounce for up to 7s (ends the moment one's attempted), then
          // (after the global ~2s backing-up stage) spend up to 11s circling
          // the target at range before cycling back to another Pounce attempt.
          behaviorStages: ['pounceAttempt', 'evasiveOrbit'],
          aggroRangePx: TILE * 6.2, leashRangePx: TILE * 9,
          canClimb: false, canSwim: false,
          modelWidth: 2.1, tint: 0xffffff,
          sprites: {
            idle: 'assets/creaturesprites/gar-wolf_idle.png',
            run: ['assets/creaturesprites/gar-wolf_run1.png', 'assets/creaturesprites/gar-wolf_run2.png'],
          },
          loot: [
            { key: 'garWolfMeat', min: 2, max: 4 },
            { key: 'garWolfHide', min: 1, max: 1 },
          ],
        },
        'gar-wolf-alpha': {
          label: 'Gar-wolf Alpha', hostile: true,
          maxHealth: 78, maxStamina: 46,
          moveSpeed: 140, chaseSpeed: 205,
          attackDamage: 18, attackRangePx: TILE * 0.95, attackHalfConeRad: 46 * Math.PI / 180,
          attackStaminaCost: 16, attackCooldownS: 1.0,
          attacks: ['pounce'],
          behaviorStages: ['pounceAttempt', 'evasiveOrbit'],
          aggroRangePx: TILE * 7, leashRangePx: TILE * 10,
          canClimb: false, canSwim: false,
          modelWidth: 3.1, tint: 0xffb0a0,
          sprites: {
            idle: 'assets/creaturesprites/gar-wolf_idle.png',
            run: ['assets/creaturesprites/gar-wolf_run1.png', 'assets/creaturesprites/gar-wolf_run2.png'],
          },
          loot: [
            { key: 'alphaGarWolfMeat', min: 4, max: 7 },
            { key: 'alphaGarWolfHide', min: 1, max: 2 },
          ],
        },
      };

      // Minimal standalone exterior zones reachable from the town's pre-authored
      // "To Northern Cliffs" / "To Southern Cloud Forest" transition spots. Each
      // is a small flat all-grass map built lazily the first time it's entered;
      // this is where the ambient hostile spawns actually live now.
      const EXTERIOR_ZONES = {
        map_northern_cliffs: {
          label: 'Northern Cliffs',
          cols: 22, rows: 16,
          groundColor: 0x6b7280, fogColor: 0x3a4148,
          hostileKey: 'gar-wolf-alpha',
          entryCol: 11, entryRow: 14,
          exitCol: 11, exitRow: 15,
          townReturnCol: 30, townReturnRow: 2,
          audioIndex: 'northern_cliffs',
        },
        map_southern_cloud_forest: {
          label: 'Southern Cloud Forest',
          cols: 22, rows: 16,
          groundColor: 0x2d4a3a, fogColor: 0x1c2e24,
          hostileKey: 'gar-wolf',
          entryCol: 11, entryRow: 1,
          exitCol: 11, exitRow: 0,
          townReturnCol: 30, townReturnRow: 48,
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
          entryCol: 48, entryRow: 20,
          exitCol: 48, exitRow: 20,
          townReturnCol: 1, townReturnRow: 25,
        },
        map_eastern_mire: {
          label: 'Eastern Mire',
          cols: 50, rows: 40,
          groundColor: 0x3a4a3a, fogColor: 0x22301f,
          entryCol: 1, entryRow: 20,
          exitCol: 1, exitRow: 20,
          townReturnCol: 58, townReturnRow: 25,
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

      let gearInventory = null; // Loaded from player profile — character-scoped
      let packClothing  = [];   // Clothing items in world/pack inventory

      // Tool item definitions: sprite path, compatible slots, animation style
      const TOOL_ITEM_DEFS = {
        bronzehoe:    { label: 'Bronze Hoe',    icon: '🪓', sprite: 'assets/toolsprites/hoe_bronzehoe.png',        slots: ['hoe'],                    animStyle: 'chop'   },
        hatchet:      { label: 'Hatchet',       icon: '🪓', sprite: 'assets/toolsprites/axe_hatchet.png',          slots: ['axe', 'weapon'],           animStyle: 'sweep'  },
        // `spinning` distinguishes the harpoon-slot sprite's in-hand behavior: mace-mode items
        // twirl around their own axis through the swing (call it "spinning" rather than
        // "mace mode" since fishing hatchets or other harpoon variants may reuse the same flag),
        // while spear-mode items stay rigidly oriented like the hatchet sweep.
        fishingmace:  { label: 'Fishing Mace',  icon: '🎣', sprite: 'assets/toolsprites/harpoon_fishingmace.png',  slots: ['harpoon', 'weapon'],        animStyle: 'sweep', spinning: true  },
        fishingspear: { label: 'Fishing Spear', icon: '🎣', sprite: 'assets/toolsprites/harpoon_fishingspear.png', slots: ['harpoon', 'weapon'],        animStyle: 'thrust', spinning: false },
        pickshovel:   { label: 'Pick-Shovel',   icon: '⛏️', sprite: 'assets/toolsprites/shovel_pickshovel.png',    slots: ['shovel', 'pick', 'weapon'], animStyle: 'thrust' },
      };

      window.ToolIconRender?.warm(Object.values(TOOL_ITEM_DEFS).map(d => d.sprite));

      // Resolved icon for a tool-select badge (the equipped item's own
      // sprite, upright and trimmed) — falls back to `fallbackEmoji` until
      // the sprite has finished loading, or if the slot holds nothing.
      function toolSelectIconHTML(def, fallbackEmoji, cssSize) {
        if (def?.sprite) {
          const html = window.ToolIconRender?.getIconHTML(def.sprite, 'plain', cssSize, def.label);
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
        } else if (tool === 'harpoon' && action === 'fish') {
          style = 'plain';
        }
        if (!style) return fallbackEmoji;
        const html = window.ToolIconRender?.getIconHTML(def.sprite, style, '1.3em', def.label + ' ' + action);
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
          tools:    { bronzehoe: true, hatchet: true, fishingmace: true, fishingspear: true, pickshovel: true },
          clothing: { hat: null, hood: null, torso: null, overwear: null },
          clothingItems: [],
          charms: [],
          whistles: [
            { id: 'whistle_bingo', creatureKey: 'dabinggi-hound', name: 'Bingo' },
          ],
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

      // ── Decorative / interior furniture ─────────────────────────────
      // These are placed inside the house. Each has a GLB model in assets/models/furniture/.
      // area: 'interior' = house only, 'farm' = farm only, 'any' = either
      const DECORATIVE_FURNITURE_DEFS = {
        basicBed:      { itemKey: 'basicBedFurniture',      icon: '🛏️', name: 'Single Bed',          modelFile: 'basicbed_single_refined.glb',  price: 35, fw: 1, fd: 2, color: 0x8b6540, area: 'interior', desc: 'A comfortable single bed for restful sleep.' },
        doubleBed:     { itemKey: 'doubleBedFurniture',     icon: '🛏️', name: 'Double Bed',           modelFile: 'basicbed_double_refined.glb',  price: 55, fw: 2, fd: 2, color: 0x8b6540, area: 'interior', desc: 'A spacious double bed.' },
        bedroll:       { itemKey: 'bedrollFurniture',       icon: '🛌', name: 'Bedroll',              modelFile: 'bedroll_folded.glb',            price: 12, fw: 1, fd: 1, color: 0x6b8c5e, area: 'interior', desc: 'A simple folded bedroll for sleeping rough.' },
        bench:         { itemKey: 'benchFurniture',         icon: '🪑', name: 'Short Bench',          modelFile: 'bench_short.glb',              price: 18, fw: 2, fd: 1, color: 0x7a5c3a, area: 'interior', desc: 'A short wooden bench.' },
        bookshelf:     { itemKey: 'bookshelfFurniture',     icon: '📚', name: 'Bookshelf',            modelFile: 'bookshelf_low.glb',            price: 28, fw: 2, fd: 1, color: 0x6b4a28, area: 'interior', desc: 'A low bookshelf.' },
        bucket:        { itemKey: 'bucketFurniture',        icon: '🪣', name: 'Tin Bucket',           modelFile: 'bucket_tin.glb',               price: 8,  fw: 1, fd: 1, color: 0x888888, area: 'any',      desc: 'A utilitarian tin bucket.' },
        candleTable:   { itemKey: 'candleTableFurniture',   icon: '🕯️', name: 'Candle Table',         modelFile: 'candle_table.glb',             price: 15, fw: 1, fd: 1, color: 0x5a4020, area: 'interior', desc: 'Small table with a candle for warm light.', light: { color: 0xffaa44, intensity: 0.7, distance: 5, height: 0.55 } },
        chairSimple:   { itemKey: 'chairSimpleFurniture',   icon: '🪑', name: 'Simple Chair',         modelFile: 'chair_simple.glb',             price: 12, fw: 1, fd: 1, color: 0x7a5c3a, area: 'interior', desc: 'A plain wooden chair.' },
        chairCushion:  { itemKey: 'chairCushionFurniture',  icon: '🪑', name: 'Cushioned Chair',      modelFile: 'chair_with_blue_cushion.glb',  price: 22, fw: 1, fd: 1, color: 0x3a5c8a, area: 'interior', desc: 'A chair with a soft blue cushion.' },
        chest:         { itemKey: 'chestFurniture',         icon: '📦', name: 'Storage Chest',        modelFile: 'chest_storage.glb',            price: 32, fw: 1, fd: 1, color: 0x6b4a28, area: 'interior', desc: 'Sturdy wooden chest for storage.' },
        crateStack:    { itemKey: 'crateStackFurniture',    icon: '📦', name: 'Crate Stack',          modelFile: 'crate_stack.glb',              price: 14, fw: 1, fd: 1, color: 0x8a6a3a, area: 'any',      desc: 'A stack of wooden crates.' },
        copperBarrel:  { itemKey: 'copperBarrelFurniture',  icon: '🛢️', name: 'Copper Barrel',        modelFile: 'barrel_copper_hoop.glb',       price: 20, fw: 1, fd: 1, color: 0xb87333, area: 'any',      desc: 'A sturdy copper-hooped barrel.' },
        desk:          { itemKey: 'deskFurniture',          icon: '✍️', name: 'Writing Desk',         modelFile: 'desk_writing.glb',             price: 38, fw: 2, fd: 1, color: 0x6b4a28, area: 'interior', desc: 'A fine writing desk with drawers.' },
        dresser:       { itemKey: 'dresserFurniture',       icon: '🗄️', name: 'Low Dresser',          modelFile: 'dresser_low.glb',              price: 30, fw: 2, fd: 1, color: 0x6b4a28, area: 'interior', desc: 'A low dresser with drawers.' },
        hearth:        { itemKey: 'hearthFurniture',        icon: '🔥', name: 'Hearth Fireplace',     modelFile: 'hearth_fireplace.glb',         price: 60, fw: 2, fd: 1, color: 0x5a4a3a, area: 'interior', desc: 'A stone fireplace for warmth and cooking.', light: { color: 0xff7722, intensity: 1.4, distance: 7, height: 0.4 }, sfxKey: 'fireplace' },
        loom:          { itemKey: 'loomFurniture',          icon: '🧶', name: 'Small Loom',           modelFile: 'loom_small.glb',               price: 45, fw: 1, fd: 2, color: 0x8a6a3a, area: 'interior', desc: 'A small loom for weaving cloth.' },
        nightstand:    { itemKey: 'nightstandFurniture',    icon: '🕯️', name: 'Nightstand',           modelFile: 'nightstand.glb',               price: 18, fw: 1, fd: 1, color: 0x6b4a28, area: 'interior', desc: 'A small bedside table.', light: { color: 0xffaa44, intensity: 0.5, distance: 4, height: 0.5 } },
        rug:           { itemKey: 'rugFurniture',           icon: '🧶', name: 'Woven Rug',            modelFile: 'rug_woven_small.glb',          price: 22, fw: 2, fd: 2, color: 0x8a5a3a, area: 'interior', desc: 'A small decorative woven rug.' },
        standingLamp:  { itemKey: 'standingLampFurniture',  icon: '💡', name: 'Bronze Standing Lamp', modelFile: 'standing_lamp_bronze.glb',     price: 28, fw: 1, fd: 1, color: 0xb87333, area: 'interior', desc: 'A tall bronze oil lamp.', light: { color: 0xffc266, intensity: 0.9, distance: 6, height: 1.3 } },
        stool:         { itemKey: 'stoolFurniture',         icon: '🪑', name: 'Round Stool',          modelFile: 'stool_round.glb',              price: 10, fw: 1, fd: 1, color: 0x7a5c3a, area: 'any',      desc: 'A simple round stool.' },
        tableLong:     { itemKey: 'tableLongFurniture',     icon: '🍽️', name: 'Long Table',           modelFile: 'table_long.glb',               price: 42, fw: 4, fd: 1, color: 0x7a5c3a, area: 'interior', desc: 'A long communal dining table.' },
        tableRound:    { itemKey: 'tableRoundFurniture',    icon: '🍽️', name: 'Round Table',          modelFile: 'table_round.glb',              price: 28, fw: 2, fd: 2, color: 0x7a5c3a, area: 'interior', desc: 'A round wooden dining table.' },
        tableSmall:    { itemKey: 'tableSmallFurniture',    icon: '🍽️', name: 'Small Table',          modelFile: 'table_small.glb',              price: 18, fw: 1, fd: 1, color: 0x7a5c3a, area: 'interior', desc: 'A small side table.' },
        wardrobe:      { itemKey: 'wardrobeFurniture',      icon: '🚪', name: 'Tall Wardrobe',        modelFile: 'wardrobe_tall.glb',            price: 48, fw: 2, fd: 1, color: 0x6b4a28, area: 'interior', desc: 'A tall wardrobe for clothing storage.' },
        washTub:       { itemKey: 'washTubFurniture',       icon: '🛁', name: 'Copper Wash Tub',      modelFile: 'wash_tub_copper.glb',          price: 25, fw: 1, fd: 1, color: 0xb87333, area: 'any',      desc: 'A copper tub for bathing or laundry.' },
        counter:       { itemKey: 'counterFurniture',       icon: '🏪', name: 'Shop Counter',          modelFile: 'counter_shop.glb',             price: 40, fw: 3, fd: 1, color: 0x7a5c3a, area: 'interior', desc: 'A sturdy shop counter for conducting business.' },
      };

      const DECORATIVE_FURNITURE_CATALOG = Object.entries(DECORATIVE_FURNITURE_DEFS).map(([, def]) => ({
        key: def.itemKey, icon: def.icon, name: def.name, desc: def.desc,
        price: def.price, gives: { [def.itemKey]: 1 }, category: 'furniture'
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
        ...DECORATIVE_FURNITURE_CATALOG,
        ...LIVESTOCK_CATALOG
      ];

      // ── General Store catalog (Funji & Son's) ─────────────────────
      const GENERAL_STORE_CATALOG = [
        { key: 'mulchBag',      icon: '🍂', name: 'Mulch Bag',      desc: 'Boosts soil recovery and clears weeds.',        price: 3,  gives: { mulch: 5 } },
        { key: 'bucket',        icon: '🪣', name: 'Tin Bucket',     desc: 'A utilitarian tin bucket for hauling water.',   price: 8,  gives: { bucketFurniture: 1 }, category: 'goods' },
        { key: 'copperBarrel',  icon: '🛢️', name: 'Copper Barrel',  desc: 'A sturdy copper-hooped storage barrel.',       price: 20, gives: { copperBarrelFurniture: 1 }, category: 'goods' },
        { key: 'crateStack',    icon: '📦', name: 'Crate Stack',    desc: 'Stacked wooden crates for storing loose goods.',price: 14, gives: { crateStackFurniture: 1 }, category: 'goods' },
        { key: 'stool',         icon: '🪑', name: 'Round Stool',    desc: 'A simple round stool — good for any space.',    price: 10, gives: { stoolFurniture: 1 }, category: 'goods' },
        { key: 'candleTable',   icon: '🕯️', name: 'Candle Table',   desc: 'Small table with a candle for warm light.',    price: 15, gives: { candleTableFurniture: 1 }, category: 'goods' },
        { key: 'washTub',       icon: '🛁', name: 'Copper Wash Tub',desc: 'A copper tub for bathing or laundry.',         price: 25, gives: { washTubFurniture: 1 }, category: 'goods' },
        { key: 'counter',       icon: '🏪', name: 'Shop Counter',   desc: 'A sturdy counter for conducting business.',    price: 40, gives: { counterFurniture: 1 }, category: 'goods' },
      ];

      const STORE_CLOTHING_DYES = [
        { label: 'Earth',   h: -70,  s: -0.80, v: -0.55 },
        { label: 'Olive',   h: -40,  s: -0.70, v: -0.45 },
        { label: 'Sage',    h:   0,  s: -0.70, v: -0.30 },
        { label: 'Seafoam', h:  30,  s: -0.60, v: -0.15 },
        { label: 'Ash',     h:  10,  s: -0.90, v:  0.25 },
        { label: 'Onyx',    h:   0,  s: -0.90, v: -0.85 },
        { label: 'Brown',   h: -113, s: -0.45, v: -0.45 },
        { label: 'Rust',    h: -143, s: -0.40, v: -0.40 },
        { label: 'Amber',   h: -113, s: -0.35, v: -0.25 },
        { label: 'Ochre',   h:  -83, s: -0.45, v: -0.20 },
        { label: 'Lichen',  h:  -23, s: -0.55, v: -0.25 },
        { label: 'Slate',   h:   77, s: -0.75, v: -0.20 },
      ];

      const STORE_CLOTHING_PIECES = [
        { id: 'rugged_poncho', label: 'Rugged Poncho',        category: 'overwear', usesB: true,  price: 70 },
        { id: 'fine_poncho',   label: 'Fine Poncho',          category: 'overwear', usesB: true,  price: 80 },
        { id: 'fine_hood',     label: 'Fine Hood',            category: 'hood',     usesB: true,  price: 60 },
        { id: 'tankan_tunic',  label: 'Tankan Tunic',         category: 'torso',    usesB: false, price: 50 },
        { id: 'bandolier1',    label: 'Bandolier',            category: 'torso',    usesB: false, price: 40 },
        { id: 'appearance::hat::basic_headband',      label: 'Basic Headband',        category: 'hat', usesB: false, price: 35 },
        { id: 'appearance::hat::leather_headband',    label: 'Leather Headband',      category: 'hat', usesB: false, price: 40 },
        { id: 'appearance::hat::riverlandskasa_wide', label: 'Riverland Kasa (Wide)', category: 'hat', usesB: false, price: 45 },
      ];

      function generateDailyClothingStock(day) {
        const stock = [];
        for (let i = 0; i < 4; i++) {
          const piece   = STORE_CLOTHING_PIECES[Math.floor(seededRandom(day * 97 + i * 31) * STORE_CLOTHING_PIECES.length)];
          const dyeA    = STORE_CLOTHING_DYES[Math.floor(seededRandom(day * 53 + i * 71 + 13) * STORE_CLOTHING_DYES.length)];
          const dyeB    = piece.usesB ? STORE_CLOTHING_DYES[Math.floor(seededRandom(day * 113 + i * 43 + 7) * STORE_CLOTHING_DYES.length)] : null;
          const dyeLbl  = piece.usesB && dyeB ? (dyeA.label + ' & ' + dyeB.label) : dyeA.label;
          stock.push({
            uid:        'citem_gs_' + day + '_' + i,
            cosmeticId: piece.id,
            slot:       piece.category,
            label:      dyeLbl + ' ' + piece.label,
            colorA:     dyeA,
            colorB:     dyeB,
            price:      piece.price,
            sellPrice:  Math.floor(piece.price * 0.4),
            sprite:     clothingSpriteForCosmetic(piece.id),
          });
        }
        return stock;
      }

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
      const hostileObjects = new Set();   // Ambient-spawned hostile creatures (Gar-wolf / Gar-wolf Alpha).
      const corpseObjects = new Set();    // Creatures mid-death-lerp ('dying') or settled and lootable ('corpse').

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
            // Self-guarded (not just at the transferShippingAmount() UI call site)
            // so any future caller of this object's API can't bypass the farm's
            // storage-withdraw permission.
            if (!hasFarmPermission('storage')) return 0;
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
              saveMemberWorldData();
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
        const mesh = window.ProceduralFurniture.buildFurnitureGroup(furnitureKey, def.color);
        mesh.position.set(col + 0.5, tileSurfaceY(grid[row][col].type), row + 0.5);
        _markOutline(mesh);
        _markFurnitureEdgeId(mesh);
        scene.add(mesh);

        return {
          id: 'processor_' + furnitureKey + '_' + col + '_' + row,
          type: 'processing_furniture', furnitureKey, method: def.method, col, row, mesh,
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

      // ── Decorative furniture (interior) ──────────────────────────
      function getDecorativeFurnitureKeyByItemKey(itemKey) {
        const entry = Object.entries(DECORATIVE_FURNITURE_DEFS).find(([, def]) => def.itemKey === itemKey);
        return entry ? entry[0] : null;
      }

      function canPlaceDecorativeFurnitureAt(col, row) {
        const g = currentArea === 'interior' ? interiorGrid : grid;
        const tile = g[row]?.[col];
        if (!tile || tile.type === TileType.ROCK) return false;
        if (currentArea === 'farm' && isHouseFootprint(col, row)) return false;
        return !interiorFurnitureObjects.find(o => o.col === col && o.row === row);
      }

      function makeDecorativeFurnitureMesh(col, row, furnitureKey, targetScene, area = currentArea) {
        const def = DECORATIVE_FURNITURE_DEFS[furnitureKey];
        if (!def) return null;
        const group = window.ProceduralFurniture.buildFurnitureGroup(furnitureKey, def.color || 0x8b6540);
        group.position.set(col + (def.fw || 1) * 0.5, 0, row + (def.fd || 1) * 0.5);
        _markOutline(group);
        _markFurnitureEdgeId(group);
        targetScene.add(group);

        let light = null;
        if (def.light) {
          light = new THREE.PointLight(def.light.color, def.light.intensity, def.light.distance);
          light.position.set(col + 0.5, def.light.height || 0.6, row + 0.5);
          targetScene.add(light);
        }
        const sfxSource = registerFurnitureSfxSource(area, col + (def.fw || 1) * 0.5, row + (def.fd || 1) * 0.5, resolveFurnitureSfx(def));

        return { mesh: group, light, sfxSource };
      }

      function placeDecorativeFurniture(col, row, furnitureKey) {
        const def = DECORATIVE_FURNITURE_DEFS[furnitureKey];
        if (!def) return { ok: false, message: 'Unknown furniture type.' };
        const isInInterior = currentArea === 'interior';
        const isOnFarm = currentArea === 'farm';
        if (def.area === 'interior' && !isInInterior) return { ok: false, message: `${def.name} must be placed inside the house.` };
        if (def.area === 'farm' && !isOnFarm) return { ok: false, message: `${def.name} must be placed on the farm.` };
        if (!canPlaceDecorativeFurnitureAt(col, row)) return { ok: false, message: 'Cannot place furniture here.' };
        const itemKey = def.itemKey;
        if ((inventory[itemKey] || 0) < 1) return { ok: false, message: `No ${def.name} in inventory.` };
        const targetScene = isInInterior ? interiorScene : scene;
        const result = makeDecorativeFurnitureMesh(col, row, furnitureKey, targetScene, currentArea);
        if (!result) return { ok: false, message: 'Could not create furniture mesh.' };
        inventory[itemKey]--;
        clampInventoryStack(itemKey);
        interiorFurnitureObjects.push({ key: furnitureKey, col, row, mesh: result.mesh, light: result.light, sfxSource: result.sfxSource, area: currentArea });
        refreshItemScroll();
        saveFarmLayout();
        return { ok: true, message: `${def.icon} ${def.name} placed.` };
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
          unregisterFurnitureSfxSource(obj.sfxSource);
        });
        interiorFurnitureObjects.length = 0;
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
            unregisterFurnitureSfxSource(d.sfxSource);
          }
          tile.type = TileType.GRASS; tile.crop = CropType.NONE; tile.cropAge = 0; tile.cropReady = false;
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
          const nc = makeSellCrate(col, row);
          shippingBoxObject = nc; worldObjects.set(col + ',' + row, nc);
          saveFarmLayout(); showToast('Shipping box moved.', true);
        } else if (objectType === 'supplyBox' && supplyBoxObject) {
          const old = supplyBoxObject;
          worldObjects.delete(old.col + ',' + old.row);
          if (old.mesh) scene.remove(old.mesh);
          if (old.lid)  scene.remove(old.lid);
          const nb = makeSupplyBox(col, row);
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
              if (t.type !== def.type || (t.crop && t.crop !== CropType.NONE)) {
                layout.tiles.push({ c, r, type: t.type, crop: t.crop || '' });
              }
            }
          }
          processingFurnitureObjects.forEach(obj => {
            layout.furniture.push({ key: obj.furnitureKey, col: obj.col, row: obj.row });
          });
          interiorFurnitureObjects.forEach(obj => {
            layout.decor.push({ key: obj.key, col: obj.col, row: obj.row, area: obj.area });
          });
          // Preserve map-editor-authored travel data through in-game saves
          if (worldRoutes.length)      layout.routes      = worldRoutes;
          if (worldNpcPaths.length)    layout.npcPaths    = worldNpcPaths; // legacy compatibility
          if (worldTransitions.length) layout.transitions = worldTransitions;
          localStorage.setItem(farmLayoutKey(), JSON.stringify(layout));
        } catch {}
      }

      function loadFarmLayout() {
        try {
          const raw = localStorage.getItem(farmLayoutKey());
          return raw ? JSON.parse(raw) : null;
        } catch { return null; }
      }

      function applyFarmLayoutToGrid(layout) {
        if (!layout || layout.version !== 3) return;
        (layout.tiles || []).forEach(({ c, r, type, crop }) => {
          if (grid[r]?.[c]) {
            grid[r][c].type = type;
            // Saved layouts don't persist trench depth — restore at full depth.
            if (type === TileType.TRENCH) grid[r][c].depth = 1;
            grid[r][c].crop = crop || CropType.NONE;
            if (crop) { grid[r][c].cropAge = 50; grid[r][c].cropReady = false; }
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
            const nc = makeSellCrate(c, r); shippingBoxObject = nc; worldObjects.set(c + ',' + r, nc);
          }
        }
        if (layout.objects?.supplyBox) {
          const [c, r] = layout.objects.supplyBox;
          if (supplyBoxObject && (supplyBoxObject.col !== c || supplyBoxObject.row !== r)) {
            worldObjects.delete(supplyBoxObject.col + ',' + supplyBoxObject.row);
            supplyBoxObject.reset && supplyBoxObject.reset();
            const nb = makeSupplyBox(c, r); supplyBoxObject = nb; worldObjects.set(c + ',' + r, nb);
          }
        }
        (layout.furniture || []).forEach(({ key, col, row }) => {
          if (PROCESSING_FURNITURE_DEFS[key] && canPlaceFurnitureAt(col, row)) {
            const obj = makeProcessingFurniture(col, row, key);
            if (obj) { worldObjects.set(col + ',' + row, obj); processingFurnitureObjects.add(obj); }
          }
        });
        (layout.decor || []).forEach(({ key, col, row, area }) => {
          const def = DECORATIVE_FURNITURE_DEFS[key];
          if (!def) return;
          const decorArea = area || 'farm';
          const targetScene = decorArea === 'interior' ? interiorScene : scene;
          const result = makeDecorativeFurnitureMesh(col, row, key, targetScene, decorArea);
          if (result) interiorFurnitureObjects.push({ key, col, row, mesh: result.mesh, light: result.light, sfxSource: result.sfxSource, area: decorArea });
        });
      }

      // ── Animal system ─────────────────────────────────────────────
      function canSpawnAnimalAt(col, row) {
        const tile = grid[row]?.[col];
        if (!tile || getWorldObjectAt(col, row)) return false;
        if (tile.crop || isSolid(tile.type) || tile.type === TileType.TRENCH || tile.type === TileType.RIVER || tile.type === TileType.STREAM) return false;
        return true;
      }

      function makeUumkaoiiAnimal(col, row, livestockId) {
        const ANIMAL_W = 1.275;
        const ANIMAL_H = ANIMAL_W * (451 / 641); // sprite is 641x451 px
        const halfH = ANIMAL_H / 2;

        const avatarRef = window.PNGPlaneAvatar.buildAnimalPlaneAvatarModel(THREE, "assets/creaturesprites/uumkao'ii.png", {
          modelWidth: ANIMAL_W, modelHeight: ANIMAL_H,
          name: 'uumkaoii_' + col + '_' + row,
        });

        const initSurfY = tileSurfaceY(grid[row][col].type);
        avatarRef.group.position.set(col + 0.5, initSurfY + halfH, row + 0.5);
        avatarRef.group.rotation.y = Math.PI / 2; // start facing east
        _markPngPlane(avatarRef.group);
        scene.add(avatarRef.group);

        let tickCounter = 0;
        const animal = {
          id: 'uumkaoii_' + col + '_' + row + '_' + (performance.now() | 0),
          livestockId: livestockId || ('livestock_' + Math.random().toString(36).slice(2, 10)),
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

            // Once it's settled at its target tile (not mid-hop), an animal has no
            // specific direction to look — let it rest broadside to the camera.
            const idle = Math.abs(tx - this.wx) < 0.02 && Math.abs(tz - this.wz) < 0.02;
            const lookTarget = idle ? nearestAngleAmong(this.groupRot, cameraRelativePerps()) : this.targetRot;
            const { effectiveTarget, snapTo } = perpClamp(this.perpState, lookTarget, cameraRelativeCreaturePerps(), CREATURE_PERP_DEAD_RAD);
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

      // Livestock kind → factory, so restoring saved livestock on world load
      // can dispatch by kind without hardcoding uumkao'ii — the array this
      // reads is meant to grow into other livestock types later.
      const LIVESTOCK_FACTORIES = { uumkaoii: makeUumkaoiiAnimal };

      function spawnUumkaoii(col, row) {
        if (!canSpawnAnimalAt(col, row)) return { ok: false, message: 'The uumkao\'ii can\'t be released here.' };
        if ((inventory.uumkaoiiCrate || 0) < 1) return { ok: false, message: 'No Uumkao\'ii Crate in bag.' };
        const animal = makeUumkaoiiAnimal(col, row);
        if (!animal) return { ok: false, message: 'Sprite still loading — try again in a moment.' };
        inventory.uumkaoiiCrate--;
        clampInventoryStack('uumkaoiiCrate');
        worldObjects.set(col + ',' + row, animal);
        animalObjects.add(animal);
        // Livestock belongs to the world, not this character — persisted
        // separately from saveMemberWorldData() so it stays behind for
        // anyone who plays this world, not just whoever released it.
        const livestock = _loadWorldLivestock();
        livestock.push({ id: animal.livestockId, kind: 'uumkaoii', col, row, releasedAt: Date.now() });
        _saveWorldLivestock(livestock);
        return { ok: true, message: "🦆 Uumkao'ii released!" };
      }

      // Recreates every animal this world's owner (or any farmhand) has ever
      // released, from the world's own saved livestock list — called once
      // per world load, after furniture placement so canSpawnAnimalAt's
      // occupancy check sees the final tile state.
      function respawnWorldLivestock() {
        for (const entry of _loadWorldLivestock()) {
          const factory = LIVESTOCK_FACTORIES[entry.kind];
          if (!factory || !canSpawnAnimalAt(entry.col, entry.row)) continue;
          const animal = factory(entry.col, entry.row, entry.id);
          if (!animal) continue;
          worldObjects.set(entry.col + ',' + entry.row, animal);
          animalObjects.add(animal);
        }
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
      function setCreatureFrame(avatarRef, url) {
        for (const child of avatarRef.group.children) {
          if (!child.material) continue;
          if (child.name.endsWith('_front_plane')) child.material.map = _getCreatureFrontTexture(url);
          else if (child.name.endsWith('_back_plane')) child.material.map = _getCreatureBackTexture(url);
          else continue;
          child.material.needsUpdate = true;
        }
      }

      // spriteUrl -> resolved bottom-opacity ratio (0..1, see
      // creaturePlaneGroundOffset), or a Set of pending callbacks while
      // the very first scan of that species' idle sprite is still loading.
      const _creatureGroundAnchorCache = new Map();

      // Scans a species' idle sprite (cached per URL, so only the first
      // creature of each species actually pays for it) for how far down its
      // real opaque pixels extend. All these sprites are nominally
      // 1375×600, but if the art itself doesn't reach the canvas's bottom
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
        const modelHeight = modelWidth * (600 / 1375); // all creature sprites are 1375×600px
        const halfH = modelHeight / 2;
        const idUniq = (performance.now() | 0) + '_' + Math.floor(Math.random() * 100000);
        const avatarRef = window.PNGPlaneAvatar.buildAnimalPlaneAvatarModel(THREE, def.sprites.idle, {
          modelWidth, modelHeight,
          name: creatureKey + '_' + idUniq,
        });
        avatarRef.frontPlane = avatarRef.group.children[0] || null;
        avatarRef.backPlane  = avatarRef.group.children[1] || null;
        if (def.tint && def.tint !== 0xffffff) {
          for (const child of avatarRef.group.children) {
            if (child.material) child.material.color.setHex(def.tint);
          }
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
        const shadowRadii = creatureGroundShadowRadii(def);
        groundShadow.scale.set(shadowRadii.radiusX, 1, shadowRadii.radiusZ);
        groundShadow.position.set(x / TILE, surfY + characterGroundShadowSurfaceOffset(), y / TILE);
        targetScene.add(groundShadow);

        const creature = {
          id: creatureKey + '_' + idUniq,
          creatureKey, def, avatarRef, groundShadow,
          x, y, vx: 0, vy: 0,
          halfHeight: halfH,
          health: def.maxHealth, maxHealth: def.maxHealth,
          stamina: def.maxStamina, maxStamina: def.maxStamina,
          facing: 0, groupRot: 0, pngRot: 0, perpState: {},
          scaleY: 1,
          attackCooldownT: 0, retreatT: 0, hitFlashT: 0,
          knockbackT: 0, knockbackVX: 0, knockbackVY: 0,
          runFrame: 0, runFrameT: 0, currentFrameUrl: def.sprites.idle,
          isCompanion: false,
          name: def.label,
          state: 'idle',
          wanderTarget: null, wanderT: 0,
          homeX: x, homeY: y,
          scene: targetScene, areaGrid: targetGrid, areaCols: gridCols, areaRows: gridRows, areaId: currentArea,
          ...restOpts,
        };
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
      }

      // ── Death ragdoll → lootable corpse ─────────────────────────────
      //
      // A lethally-hit creature no longer just vanishes: it tumbles from
      // where it died to a nearby tile roughly away from the killing blow,
      // settles lying flat on that tile, and stays there as a lootable
      // corpse (see getCorpseObjectAt) until the player butchers it —
      // that's the only thing that actually despawns the sprite.
      const DEATH_LERP_DURATION_S = 2.2;
      const DEATH_TUMBLE_TILES_MIN = 1.1;
      const DEATH_TUMBLE_TILES_MAX = 2.6;
      const DEATH_AIM_CONE_RAD = 50 * Math.PI / 180;
      const DEATH_HOP_HEIGHT_PX = TILE * 1.1 / 3;
      const DEATH_FLIP_SEGMENTS = 5;
      const DEATH_FLIP_AXES = ['x', 'y', 'z'];

      // Ease-in-out (slow at each end, fast through the middle) applied
      // within a single flip segment — gives every flip a "slo-mo" hang at
      // its start/end instead of spinning at a constant rate.
      function deathFlipSegmentEase(x) { return x * x * (3 - 2 * x); }

      // Walks outward from the creature's own tile within a cone around
      // awayAngle (the direction the killing blow traveled), looking for a
      // tile the corpse can actually rest on — falls back to its own tile
      // if nothing nearby is valid (map edge, water, cliff face, ...).
      function findDeathRestTile(c, awayAngle) {
        const startCol = Math.floor(c.x / TILE), startRow = Math.floor(c.y / TILE);
        for (let attempt = 0; attempt < 12; attempt++) {
          const ang = awayAngle + (Math.random() * 2 - 1) * DEATH_AIM_CONE_RAD;
          const distTiles = DEATH_TUMBLE_TILES_MIN + Math.random() * (DEATH_TUMBLE_TILES_MAX - DEATH_TUMBLE_TILES_MIN);
          const col = clamp(Math.round(startCol + Math.cos(ang) * distTiles), 0, (c.areaCols || COLS) - 1);
          const row = clamp(Math.round(startRow + Math.sin(ang) * distTiles), 0, (c.areaRows || ROWS) - 1);
          const cx = (col + 0.5) * TILE, cy = (row + 0.5) * TILE;
          if (canOccupyAt(cx, cy, TILE * 0.3)) return { x: cx, y: cy, col, row };
        }
        return { x: (startCol + 0.5) * TILE, y: (startRow + 0.5) * TILE, col: startCol, row: startRow };
      }

      function beginCreatureDeath(c, fromX, fromY) {
        const awayAngle = fromX !== undefined ? Math.atan2(c.y - fromY, c.x - fromX) : (c.facing || 0);
        const rest = findDeathRestTile(c, awayAngle);
        c.state = 'dying';
        c.deathT = 0;
        c.deathDurationS = DEATH_LERP_DURATION_S;
        c.deathStartX = c.x; c.deathStartY = c.y;
        c.deathTargetX = rest.x; c.deathTargetY = rest.y;
        c.corpseCol = rest.col; c.corpseRow = rest.row;
        c.deathHopHeightPx = DEATH_HOP_HEIGHT_PX * (0.7 + Math.random() * 0.6);
        // The avatar's flat cutout plane has its face-normal along the
        // group's own local X axis at rest (see buildAnimalPlaneAvatarModel:
        // frontPlane.rotation.y = +PI/2, backPlane.rotation.y = -PI/2 — a
        // standing side-view cutout, not a volumetric cross). Rotating the
        // GROUP about its local Z axis by exactly +PI/2 is what tips that
        // face-normal from horizontal up to vertical (+Y) — i.e. actually
        // lying flat, face-up, not just spinning in place. Y (yaw/compass
        // heading) and X (a small final roll) can be anything — neither
        // affects flatness.
        c.deathRestRotZ = Math.PI / 2;
        c.deathRestRotX = (Math.random() * 2 - 1) * 0.22;
        c.deathRestRotY = Math.random() * Math.PI * 2;
        // A dramatic mid-air ragdoll: DEATH_FLIP_SEGMENTS separate flips,
        // each one full turn (so it can never leave a residual tilt behind)
        // about a randomly picked axis in a randomly picked direction — a
        // forward somersault, then maybe a cartwheel, then a twist, etc.
        // Because every segment is exactly ±1 full turn, the axis that
        // governs flatness (z) always ends up an integer number of full
        // turns past its target regardless of how the 5 picks landed, so it
        // still always settles into the same clean flat pose.
        c.deathFlipSegAxis = Array.from({ length: DEATH_FLIP_SEGMENTS }, () => DEATH_FLIP_AXES[Math.floor(Math.random() * DEATH_FLIP_AXES.length)]);
        c.deathFlipSegDir  = Array.from({ length: DEATH_FLIP_SEGMENTS }, () => (Math.random() < 0.5 ? -1 : 1));
        c.deathFlipPrefix = { x: [0], y: [0], z: [0] };
        for (let i = 0; i < DEATH_FLIP_SEGMENTS; i++) {
          for (const axis of DEATH_FLIP_AXES) {
            const add = c.deathFlipSegAxis[i] === axis ? c.deathFlipSegDir[i] : 0;
            c.deathFlipPrefix[axis].push(c.deathFlipPrefix[axis][i] + add);
          }
        }
        c.scaleY = 1;
        c.avatarRef.group.scale.y = 1;
        // Snap the cutout's two planes back to the exact pose they were
        // built with, undoing any camera-relative deadzone drift
        // (updateCreatureMesh's pngRot/perpState smoothing) frozen in at the
        // moment of death — otherwise the corpse lands a few degrees off
        // "flat" instead of showing its clean flat face.
        if (c.avatarRef.frontPlane) c.avatarRef.frontPlane.rotation.y = Math.PI / 2;
        if (c.avatarRef.backPlane)  c.avatarRef.backPlane.rotation.y  = -Math.PI / 2;
        corpseObjects.add(c);
      }

      // Turns accumulated for one axis by time-progress t: whole turns from
      // every completed segment assigned to that axis, plus the current
      // segment's own partial turn (eased) if it happens to be the one
      // actively spinning that axis right now.
      function deathSpinTurnsForAxis(c, seg, segEase, axis) {
        let turns = c.deathFlipPrefix[axis][seg];
        if (c.deathFlipSegAxis[seg] === axis) turns += c.deathFlipSegDir[seg] * segEase;
        return turns;
      }

      // Drives every 'dying' corpse's flight from where it died to its
      // resting tile: position eases (fast launch, soft landing) along a
      // shallow hop arc, while rotation.x/y/z ease toward their final pose
      // (Z fixed at lying-flat, X/Y free) with DEATH_FLIP_SEGMENTS full
      // mid-air flips — each on its own randomly-picked axis — layered on
      // top so the tumble shifts axes as it goes but still always lands
      // exactly on the flat pose.
      function updateCorpses(dt) {
        for (const c of corpseObjects) {
          if (c.state !== 'dying' || c.areaId !== currentArea) continue;
          c.deathT = Math.min(c.deathDurationS, c.deathT + dt);
          const t = c.deathT / c.deathDurationS;
          const ease = 1 - Math.pow(1 - t, 3);
          c.x = c.deathStartX + (c.deathTargetX - c.deathStartX) * ease;
          c.y = c.deathStartY + (c.deathTargetY - c.deathStartY) * ease;
          const hop = Math.sin(Math.PI * t) * c.deathHopHeightPx;

          const grp = c.avatarRef.group;
          const g = c.areaGrid || grid;
          const col = clamp(Math.floor(c.x / TILE), 0, (c.areaCols || COLS) - 1);
          const row = clamp(Math.floor(c.y / TILE), 0, (c.areaRows || ROWS) - 1);
          const surfY = g[row]?.[col] ? tileSurfaceYInArea(g[row][col], c.areaId) : 0;
          const restHeight = c.halfHeight * 0.12;

          grp.position.x = c.x / TILE;
          grp.position.z = c.y / TILE;
          grp.position.y = surfY + restHeight + (c.halfHeight - restHeight) * (1 - ease) + hop;
          // Stays flat on the ground under the tumble instead of following
          // the body's hop arc — same as a real jump shadow.
          if (c.groundShadow) c.groundShadow.position.set(grp.position.x, surfY + characterGroundShadowSurfaceOffset(), grp.position.z);

          let seg = Math.floor(t * DEATH_FLIP_SEGMENTS);
          let segT = t * DEATH_FLIP_SEGMENTS - seg;
          if (seg >= DEATH_FLIP_SEGMENTS) { seg = DEATH_FLIP_SEGMENTS - 1; segT = 1; }
          const segEase = deathFlipSegmentEase(segT);
          const turnsX = deathSpinTurnsForAxis(c, seg, segEase, 'x');
          const turnsY = deathSpinTurnsForAxis(c, seg, segEase, 'y');
          const turnsZ = deathSpinTurnsForAxis(c, seg, segEase, 'z');

          // Z is the axis that actually tips the cutout's flat face from
          // vertical to lying-flat-face-up (see beginCreatureDeath) — X/Y
          // are free cosmetic spin that never affects whether it lands flat.
          grp.rotation.z = c.deathRestRotZ * ease + turnsZ * Math.PI * 2;
          grp.rotation.x = c.deathRestRotX * ease + turnsX * Math.PI * 2;
          grp.rotation.y = c.groupRot + (c.deathRestRotY - c.groupRot) * ease + turnsY * Math.PI * 2;

          if (t >= 1) {
            c.state = 'corpse';
            grp.position.set(c.deathTargetX / TILE, surfY + restHeight, c.deathTargetY / TILE);
            grp.rotation.set(c.deathRestRotX, c.deathRestRotY, c.deathRestRotZ);
          }
        }
      }

      function rollLootFromTable(lootTable) {
        const gained = {};
        for (const entry of lootTable || []) {
          const qty = entry.min + Math.floor(Math.random() * (entry.max - entry.min + 1));
          if (qty > 0) gained[entry.key] = (gained[entry.key] || 0) + qty;
        }
        return gained;
      }

      // Settled corpses expose the same getButtons()/onAction() shape as
      // farm world objects (see makeSellCrate) so the existing action-bar
      // wiring (getWorldObjectAt → getButtons/onAction) can loot them with
      // no special-casing. Looting is what actually despawns the sprite.
      function makeCorpseWorldObject(c) {
        return {
          id: 'corpse_' + c.id,
          type: 'creature_corpse',
          getButtons() {
            return [{ icon: '🍖', label: 'Butcher ' + c.def.label, action: 'obj_loot_corpse', style: 'primary', allowed: true }];
          },
          onAction(action) {
            if (action !== 'obj_loot_corpse') return { ok: false, message: 'Unknown action.' };
            const gained = rollLootFromTable(c.def.loot);
            const parts = [];
            Object.entries(gained).forEach(([key, qty]) => {
              inventory[key] = Math.min(99, (inventory[key] || 0) + qty);
              parts.push(itemIconForKey(key) + '×' + qty);
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

      // Zone-aware corpse lookup — getWorldObjectAt only otherwise covers
      // farm/interior, but corpses can settle in any area a creature dies in.
      function getCorpseObjectAt(col, row) {
        for (const c of corpseObjects) {
          if (c.state !== 'corpse' || c.areaId !== currentArea) continue;
          if (c.corpseCol === col && c.corpseRow === row) return makeCorpseWorldObject(c);
        }
        return null;
      }

      function damageCreature(c, amount, fromX, fromY, knockbackPxS) {
        c.health = Math.max(0, c.health - amount);
        c.hitFlashT = 0.25;
        spawnCreatureHitSpark(c);
        if (c.health <= 0) {
          hostileObjects.delete(c);
          companionObjects.delete(c);
          beginCreatureDeath(c, fromX, fromY);
          return;
        }
        if (fromX !== undefined) applyKnockback(c, fromX, fromY, knockbackPxS);
      }

      function damagePlayer(amount, fromX, fromY, knockbackPxS = PLAYER_KNOCKBACK_PX_S) {
        if (performance.now() < player.invulnUntil) return;
        // Lets a held defensive ability (Counter Shield) absorb the hit and
        // riposte instead of applying damage normally — only one hold
        // ability can be active at a time, so this is a single settable slot.
        if (window.Combat?.tryInterceptPlayerDamage?.(amount, fromX, fromY)) return;
        player.health = Math.max(0, player.health - amount);
        if (fromX !== undefined && player.health > 0) applyKnockback(player, fromX, fromY, knockbackPxS);
        if (player.health <= 0) respawnPlayer();
      }

      function respawnPlayer() {
        player.x = COLS * TILE * 0.5;
        player.y = ROWS * TILE * 0.72;
        player.health = Math.round(player.maxHealth * 0.5);
        player.invulnUntil = performance.now() + 1000;
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

      function resolveWeaponHit(action) {
        const abil = weaponAbility(action);
        if (!abil) return { hits: 0, message: '' };
        playWeaponSlashSfx();
        let hits = 0;
        let lastName = '';
        for (const c of hostileObjects) {
          if (c.health <= 0) continue;
          if (c.areaId !== currentArea) continue;
          if (!inCone(player.x, player.y, player.angle, c.x, c.y, abil.rangePx, abil.halfConeRad)) continue;
          damageCreature(c, abil.damage, player.x, player.y, abil.knockbackPxS);
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
      function findAutoTarget() {
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

      // Swap the auto-target to the nearest hostile roughly in `aimAngle`'s
      // direction (within range, within a 90° cone either side), excluding
      // whatever is currently targeted. Used by the desktop swap-target input
      // (mouse/right-stick direction) and the mobile swap-target stick button.
      function swapAutoTarget(aimAngle) {
        if (activeTool !== 'weapon') return false;
        const current = findAutoTarget();
        const maxDist = TILE * (Number(combatConfig().autoTargetRangeTiles) || 0);
        let best = null, bestScore = -Infinity;
        for (const c of hostileObjects) {
          if (c.health <= 0 || c.areaId !== currentArea || c === current) continue;
          const dx = c.x - player.x, dy = c.y - player.y;
          const dist = Math.hypot(dx, dy);
          if (dist > maxDist || dist < 0.001) continue;
          const angleToC = Math.atan2(dy, dx);
          const diff = Math.abs(angleDiff(angleToC, aimAngle));
          if (diff > Math.PI / 2) continue;
          const score = Math.cos(diff) - (dist / maxDist) * 0.25;
          if (score > bestScore) { bestScore = score; best = c; }
        }
        if (!best) return false;
        manualAutoTarget = best;
        return true;
      }

      // Shared by hostiles, companions, and wandering creatures — covers every
      // creature movement path with a single footstep hook.
      function tickCreatureFootsteps(c, distPx) {
        if (c.areaId !== currentArea) return; // not in the player's current area; inaudible
        if (!_footstepAdvance(c, distPx)) return;
        const distToPlayer = Math.hypot(c.x - player.x, c.y - player.y);
        if (distToPlayer > FOOTSTEP_EARSHOT_PX) return;
        const falloff = Math.pow(Math.max(0, 1 - distToPlayer / FOOTSTEP_EARSHOT_PX), 2);
        const type = footstepTileTypeAt(c.areaId, c.x, c.y, c.areaGrid);
        // Whistled companions stay quiet (like the player) and unpanned —
        // hostiles/wild creatures get the full directional treatment.
        if (c.isCompanion) { playFootstepSfx(c.areaId, type, falloff * FOOTSTEP_QUIET_SCALE); return; }
        const pan = Math.max(-1, Math.min(1, (c.x - player.x) / FOOTSTEP_PAN_RANGE_PX));
        playFootstepSfx(c.areaId, type, falloff, pan);
      }

      // Narrow terrain gate for creature movement — unlike tileSpeedAt (used by
      // the player), this only cares about cliff faces and water crossings, so
      // untagged creatures keep wandering over rock/shrub exactly as before.
      // canClimb/canSwim on the creature's CREATURE_DB entry opt out per type.
      function creatureCanEnterTile(def, wx, wy) {
        const aC = getActiveCols(), aR = getActiveRows();
        if (wx < 0 || wy < 0 || wx >= aC * TILE || wy >= aR * TILE) return false;
        const tile = getActiveGrid()[Math.floor(wy / TILE)][Math.floor(wx / TILE)];
        if (tile.incline && !def?.canClimb) return false;
        if ((tile.type === TileType.RIVER || tile.type === TileType.STREAM) && !def?.canSwim) return false;
        return true;
      }

      function moveCreatureToward(c, tx, ty, speed, dt) {
        const dx = tx - c.x, dy = ty - c.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1) { c.vx = 0; c.vy = 0; return false; }
        const nx = dx / dist, ny = dy / dist;
        const step = Math.min(dist, speed * dt);
        // Axis-separated so a creature turned back by a cliff face or river
        // slides along it instead of freezing outright (mirrors the player's
        // collision in updateMovement).
        const prevX = c.x, prevY = c.y;
        const desiredX = c.x + nx * step, desiredY = c.y + ny * step;
        if (creatureCanEnterTile(c.def, desiredX, c.y)) c.x = desiredX;
        if (creatureCanEnterTile(c.def, c.x, desiredY)) c.y = desiredY;
        const moved = Math.hypot(c.x - prevX, c.y - prevY);
        c.vx = nx * speed; c.vy = ny * speed;
        if (moved > 0) tickCreatureFootsteps(c, moved);
        return moved > 0;
      }

      function wanderTick(c, dt, anchorX, anchorY, radiusPx) {
        c.wanderT -= dt;
        if (!c.wanderTarget || c.wanderT <= 0) {
          const ang = Math.random() * Math.PI * 2;
          const r = Math.random() * radiusPx;
          c.wanderTarget = { x: anchorX + Math.cos(ang) * r, y: anchorY + Math.sin(ang) * r };
          c.wanderT = 1.5 + Math.random() * 2;
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
        // center — the target height keeps the creature's feet grounded at
        // surfY instead of sinking into the floor as it crouches.
        const scaleY = c.scaleY ?? 1;
        const tx = c.x / TILE, tz = c.y / TILE, ty = surfY + c.halfHeight * scaleY;
        grp.position.x += (tx - grp.position.x) * Math.min(1, dt * 10);
        grp.position.z += (tz - grp.position.z) * Math.min(1, dt * 10);
        grp.position.y += (ty - grp.position.y) * Math.min(1, dt * 7);
        grp.scale.y = scaleY;
        // Tracks the body's own smoothed XZ (not the raw target, and not
        // its squash/height) so the shadow doesn't lead a fast-moving
        // creature or float with it during a pounce crouch.
        if (c.groundShadow) c.groundShadow.position.set(grp.position.x, surfY + characterGroundShadowSurfaceOffset(), grp.position.z);

        const rawTargetRotY = -(aimAngle ?? 0) + Math.PI / 2;

        // Prism (group) tracks the raw aim angle freely — deadzone only governs
        // the interior PNG plane, not the prism's spatial orientation or the
        // movement/targeting logic that drives aimAngle.
        c.groupRot += angleDiff(rawTargetRotY, c.groupRot) * Math.min(1, dt * 10);
        grp.rotation.y = c.groupRot;

        // PNG planes get a separate deadzone that lerps through the perp range
        // instead of locking at the edge (see pngDeadzoneTarget).
        c.pngRot ??= c.groupRot;
        const pngTarget = pngDeadzoneTarget(c.perpState, rawTargetRotY, cameraRelativeCreaturePerps(), CREATURE_PERP_DEAD_RAD);
        c.pngRot += angleDiff(pngTarget, c.pngRot) * Math.min(1, dt * 10);
        const planeDelta = c.pngRot - c.groupRot;
        if (c.avatarRef.frontPlane) c.avatarRef.frontPlane.rotation.y = planeDelta + Math.PI / 2;
        if (c.avatarRef.backPlane)  c.avatarRef.backPlane.rotation.y  = planeDelta - Math.PI / 2;

        if (c.hitFlashT > 0) c.hitFlashT = Math.max(0, c.hitFlashT - dt);
        // Telegraph tell (combat-enemy-telegraph.js) takes a back seat to the
        // hit flash so "you damaged it" feedback still reads clearly even if
        // a strike lands mid-windup. Resolved every frame (not just on
        // change) so the tint always reverts cleanly once both clear.
        const desiredTint = c.hitFlashT > 0 ? 0xff5050
          : c.telegraphState === 'strike' ? 0xffffff
          : c.telegraphState === 'windup' ? 0xffc23d
          : (c.def.tint || 0xffffff);
        if (c._tintHex !== desiredTint) {
          c._tintHex = desiredTint;
          for (const child of grp.children) {
            if (child.material) child.material.color.setHex(desiredTint);
          }
        }
      }

      function updateCreatureAnimFrame(c, dt, moving) {
        if (!moving) {
          if (c.currentFrameUrl !== c.def.sprites.idle) {
            setCreatureFrame(c.avatarRef, c.def.sprites.idle);
            c.currentFrameUrl = c.def.sprites.idle;
          }
          return;
        }
        c.runFrameT += dt;
        if (c.runFrameT >= 0.18) {
          c.runFrameT = 0;
          c.runFrame = (c.runFrame + 1) % c.def.sprites.run.length;
        }
        const url = c.def.sprites.run[c.runFrame];
        if (c.currentFrameUrl !== url) {
          setCreatureFrame(c.avatarRef, url);
          c.currentFrameUrl = url;
        }
      }

      const JUMP_BACK_DUR_S = 0.4;
      const JUMP_BACK_SPEED = 260;

      // Bite-attack telegraph timing, ported from the sandbox's dummy AI
      // attack (its only enemy-side attack: windup 0.54s, strike 0.20s) —
      // reused for both hostiles and companions since they share this same
      // chase-then-bite shape.
      const BITE_TELEGRAPH_WINDUP_S = 0.54;
      const BITE_TELEGRAPH_STRIKE_S = 0.20;

      // Hitbox/aim-collider geometry shared between the AI's pounce-trigger
      // check and the debug hitbox overlay — derived from the avatar's
      // crossed-plane "prism" base (a square of side modelWidth, in tile
      // units) rather than an arbitrary radius.
      function creatureHitboxHalfSizePx(def) {
        return (def.modelWidth || 2) * TILE / 2;
      }
      // The forward aim collider a pounce-capable creature keeps pointed at
      // its target every chase frame: a rod starting at the head-side edge
      // of its hitbox and protruding 150% of the hitbox's own length beyond
      // that edge. A pounce only triggers once the target falls inside it.
      function creatureAimColliderReachPx(def) {
        const halfSize = creatureHitboxHalfSizePx(def);
        return halfSize + halfSize * 2 * 1.5;
      }

      // ── Slottable AI behavior-stage system ──────────────────────────
      //
      // A creature whose def lists behaviorStages (e.g. gar-wolf's
      // ['pounceAttempt', 'evasiveOrbit']) cycles through those named stages
      // in order, looping back to the first once the last finishes. Every
      // stage has either a fixed time limit (def below) or an "end early"
      // condition (pounceAttempt ends the instant it commits to a pounce,
      // not when the leap finishes resolving) — whichever comes first ends
      // the stage. After ANY stage ends, every creature using this system
      // (hostile or companion) spends a fixed ~2s backing directly away from
      // its target before the next stage starts, so a hit-and-run beat
      // separates every modular stage instead of one flowing straight into
      // the next.
      const STAGE_BACKUP_S = 2;
      const STAGE_MAX_DURATION_S = { pounceAttempt: 7, evasiveOrbit: 11 };
      const EVASIVE_ORBIT_RADIUS_MUL = 1.7; // x attackRangePx — stays just outside biting/pounce range

      function ensureCreatureStage(c, stages) {
        if (!c._stage || c._stage.stages !== stages) {
          c._stage = { stages, idx: 0, mode: 'active', t: 0, orbitSign: Math.random() < 0.5 ? -1 : 1 };
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
        st.orbitSign = Math.random() < 0.5 ? -1 : 1;
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
          c.stamina = Math.min(c.maxStamina, c.stamina + c.maxStamina * 0.25 * dt);

          const dxp = player.x - c.x, dyp = player.y - c.y;
          const distToPlayer = Math.hypot(dxp, dyp);
          const distFromHome = Math.hypot(c.x - c.homeX, c.y - c.homeY);

          if (c.state !== 'chase' && distToPlayer <= def.aggroRangePx) c.state = 'chase';
          if (c.state === 'chase' && (distToPlayer > def.leashRangePx || distFromHome > def.leashRangePx)) c.state = 'return';
          if (c.state === 'return' && distFromHome < TILE * 0.6) c.state = 'idle';
          // Leaving chase mid-windup (player broke the leash) abandons the
          // telegraphed bite/modular attack rather than landing it from way
          // out of range.
          if (c.state !== 'chase' && window.Combat?.telegraph?.isBusy(c)) window.Combat.telegraph.cancel(c);
          if (c.state !== 'chase' && window.Combat?.animalAttacks?.isBusy(c)) window.Combat.animalAttacks.cancel(c);
          if (c.state !== 'chase') clearCreatureStage(c);

          let moving = false, aimAngle = c.facing || 0;
          if (c.knockbackT > 0) {
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
          } else if (c.state === 'chase') {
            aimAngle = Math.atan2(dyp, dxp);
            if (c.retreatT > 0) {
              // Jump back after landing a bite, keeping eyes on the player.
              c.retreatT = Math.max(0, c.retreatT - dt);
              const awayAng = Math.atan2(-dyp, -dxp);
              moving = moveCreatureToward(c, c.x + Math.cos(awayAng) * TILE, c.y + Math.sin(awayAng) * TILE, JUMP_BACK_SPEED, dt);
            } else if (window.Combat?.telegraph?.isBusy(c)) {
              // Stand and wind up — the tell (game.js's tint) is the
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
              const result = updateCreatureBehaviorStage(c, dt, player, def, (dist) => {
                const triggerRangePx = creatureAimColliderReachPx(def);
                if (dist > triggerRangePx || c.attackCooldownT > 0 || c.stamina < def.attackStaminaCost) return false;
                c.stamina -= def.attackStaminaCost;
                c.attackCooldownT = def.attackCooldownS;
                return !!(def.attacks?.length && window.Combat?.animalAttacks?.start(
                  c, def.attacks[Math.floor(Math.random() * def.attacks.length)], { target: player }
                ));
              });
              aimAngle = result.aimAngle;
              moving = result.moving;
            } else {
              moving = moveCreatureToward(c, player.x, player.y, def.chaseSpeed, dt);
              // Pounce-capable creatures commit once the target enters their
              // forward aim collider (always pointed straight at the target
              // via aimAngle above) rather than the bite's short flat range.
              const pounceCapable = def.attacks?.includes('pounce');
              const triggerRangePx = pounceCapable ? creatureAimColliderReachPx(def) : def.attackRangePx;
              if (distToPlayer <= triggerRangePx && c.attackCooldownT <= 0 && c.stamina >= def.attackStaminaCost) {
                c.stamina -= def.attackStaminaCost;
                c.attackCooldownT = def.attackCooldownS;
                const startedModular = def.attacks?.length && window.Combat?.animalAttacks?.start(
                  c, def.attacks[Math.floor(Math.random() * def.attacks.length)], { target: player }
                );
                if (startedModular) aimAngle = c.facing;
                if (!startedModular) {
                  window.Combat.telegraph.start(c, {
                    windupS: BITE_TELEGRAPH_WINDUP_S,
                    strikeS: BITE_TELEGRAPH_STRIKE_S,
                    onStrike: () => {
                      if (Math.hypot(player.x - c.x, player.y - c.y) <= def.attackRangePx) {
                        damagePlayer(def.attackDamage, c.x, c.y, HOSTILE_BITE_KNOCKBACK_PX_S);
                        playCreatureClawHit(c);
                      }
                      c.retreatT = JUMP_BACK_DUR_S;
                    },
                  });
                }
              }
            }
          } else if (c.state === 'return') {
            moving = moveCreatureToward(c, c.homeX, c.homeY, def.moveSpeed, dt);
            if (moving) aimAngle = Math.atan2(c.homeY - c.y, c.homeX - c.x);
          } else {
            moving = wanderTick(c, dt, c.homeX, c.homeY, TILE * 2.2);
            // Wandering has an explicit heading; paused between legs, there's no
            // specific direction to look, so settle broadside to the camera.
            aimAngle = moving ? Math.atan2(c.vy, c.vx) : idleCreatureAimAngle(c.groupRot);
          }
          c.facing = aimAngle;
          c.x = clamp(c.x, 0, (c.areaCols || COLS) * TILE);
          c.y = clamp(c.y, 0, (c.areaRows || ROWS) * TILE);

          updateCreatureMesh(c, dt, aimAngle);
          // A modular attack in its leap stage owns the sprite frame (locked
          // onto a non-idle pose) — don't let the default idle/run cycling
          // stomp it back every tick.
          if (!window.Combat?.animalAttacks?.isBusy(c)) updateCreatureAnimFrame(c, dt, moving);
        }
      }

      const FOLLOW_FAR_PX  = TILE * 2.2;
      const FOLLOW_NEAR_PX = TILE * 1.1;
      const ALERT_RANGE_PX = TILE * 4.5;

      function updateCompanions(dt) {
        for (const c of companionObjects) {
          if (c.health <= 0) continue;
          if (c.areaId !== currentArea) continue;

          if (player.climbing) {
            // Teleport-and-stick: an untagged companion can't path through an
            // incline tile on its own (see CREATURE_DB canClimb / moveCreatureToward),
            // so for the duration of the climb it just clings to the player's
            // back instead of trying to follow normally.
            const backAngle = player.angle + Math.PI;
            c.x = player.x + Math.cos(backAngle) * TILE * 0.35;
            c.y = player.y + Math.sin(backAngle) * TILE * 0.35;
            c.facing = player.angle;
            c.vx = 0; c.vy = 0;
            updateCreatureMesh(c, dt, c.facing);
            updateCreatureAnimFrame(c, dt, false);
            // Pin to the player's actual climb-blended height rather than the
            // incline tile's raw (unblended) surface — see updatePlayerMesh.
            c.avatarRef.group.position.y = playerMesh.position.y + c.halfHeight * 0.5;
            continue;
          }

          const def = c.def;
          c.attackCooldownT = Math.max(0, c.attackCooldownT - dt);
          c.stamina = Math.min(c.maxStamina, c.stamina + c.maxStamina * 0.25 * dt);

          const dxp = player.x - c.x, dyp = player.y - c.y;
          const distToPlayer = Math.hypot(dxp, dyp);
          let target = null;
          for (const h of hostileObjects) {
            if (h.health <= 0) continue;
            if (h.areaId !== currentArea) continue;
            if (Math.hypot(h.x - player.x, h.y - player.y) <= ALERT_RANGE_PX) { target = h; break; }
          }

          if (!target && window.Combat?.telegraph?.isBusy(c)) window.Combat.telegraph.cancel(c);
          if (!target && window.Combat?.animalAttacks?.isBusy(c)) window.Combat.animalAttacks.cancel(c);
          if (!target) c._stage = null;

          let moving = false, aimAngle = c.facing || 0;
          if (c.knockbackT > 0) {
            // Mirrors updateHostiles' knockback branch — per-axis canOccupyAt
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
              // evasive-orbit stage — that's wild-creature-only, see
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
                if (dist <= def.attackRangePx && c.attackCooldownT <= 0 && c.stamina >= def.attackStaminaCost) {
                  c.stamina -= def.attackStaminaCost;
                  c.attackCooldownT = def.attackCooldownS;
                  // Tamed behavior: the real species attack set (e.g. Pounce)
                  // fires only once every 4 behavior actions; the other 3 use
                  // the short 0-damage/high-knockback guard charge instead.
                  c._behaviorActionCount = (c._behaviorActionCount || 0) + 1;
                  const useRealAttack = def.attacks?.length > 0 && (c._behaviorActionCount % 4 === 0);
                  const attackId = useRealAttack ? def.attacks[Math.floor(Math.random() * def.attacks.length)] : 'guardCharge';
                  const startedModular = window.Combat?.animalAttacks?.start(c, attackId, { target });
                  if (startedModular) {
                    aimAngle = c.facing;
                  } else {
                    window.Combat.telegraph.start(c, {
                      windupS: BITE_TELEGRAPH_WINDUP_S,
                      strikeS: BITE_TELEGRAPH_STRIKE_S,
                      onStrike: () => {
                        if (target.health > 0 && Math.hypot(target.x - c.x, target.y - c.y) <= def.attackRangePx) {
                          damageCreature(target, def.attackDamage, c.x, c.y, COMPANION_BITE_KNOCKBACK_PX_S);
                          playCreatureClawHit(c);
                        }
                      },
                    });
                  }
                  st.mode = 'backingUp';
                  st.t = 0;
                }
              }
            }
          } else if (distToPlayer > FOLLOW_FAR_PX) {
            moving = moveCreatureToward(c, player.x, player.y, def.chaseSpeed, dt);
            aimAngle = Math.atan2(dyp, dxp);
          } else {
            moving = wanderTick(c, dt, player.x, player.y, FOLLOW_NEAR_PX);
            if (moving) aimAngle = Math.atan2(c.vy, c.vx);
          }
          c.facing = aimAngle;
          c.x = clamp(c.x, 0, (c.areaCols || COLS) * TILE);
          c.y = clamp(c.y, 0, (c.areaRows || ROWS) * TILE);

          updateCreatureMesh(c, dt, aimAngle);
          if (!window.Combat?.animalAttacks?.isBusy(c)) updateCreatureAnimFrame(c, dt, moving);
        }
      }

      function despawnCompanions() {
        companionObjects.forEach(c => despawnCreature(c));
        companionObjects.clear();
      }

      // Spawns/despawns the active companion to match the equipped whistle.
      // Called every farm/zone-area frame; cheap no-op once in sync. Also
      // re-spawns into the new area's scene whenever the player travels.
      function syncCompanionFromWhistle() {
        const whistle = equipmentSlots.whistle
          ? (gearInventory?.whistles || []).find(w => w.id === equipmentSlots.whistle)
          : null;
        const existing = [...companionObjects][0];
        if (!whistle) {
          if (existing) despawnCompanions();
          return;
        }
        if (existing && existing.creatureKey === whistle.creatureKey && existing.areaId === currentArea) return;
        despawnCompanions();
        const spawnX = player.x + Math.cos(player.angle + Math.PI) * TILE * 1.4;
        const spawnY = player.y + Math.sin(player.angle + Math.PI) * TILE * 1.4;
        const companion = makeCreatureEntity(whistle.creatureKey, spawnX, spawnY, {
          isCompanion: true, name: whistle.name, homeX: spawnX, homeY: spawnY, state: 'idle',
        });
        if (companion) companionObjects.add(companion);
      }

      function clearHostileObjects() {
        hostileObjects.forEach(c => despawnCreature(c));
        hostileObjects.clear();
      }

      // ── Tothal Shift ────────────────────────────────────────────────
      // A yearly reroll of the seed behind all four wilderness maps (Northern
      // Cliffs, Southern Cloud Forest, Western Slope, Eastern Mire) — in lore
      // terms, the wilderness itself reshapes at the turn of the year. This
      // reproduces exactly what the Wilderness Map Generator tool's "Export"
      // → Map Editor's "Import" round-trip would do to a zone map: a random
      // seed and the zone's own entry side (so the gate still faces Hobunji
      // Hollow) are the only inputs, everything else is the standalone tool's
      // stock defaults, with zero post-processing — the generator's headless
      // core (docs/js/wilderness-map-generator.js) hands its export straight
      // to the same plateau/ramp fold math the Map Editor's live preview
      // already uses (docs/js/terrain-preview.js), and the game renders it
      // exactly as it would an authored map. A handful of authored building
      // entrances (Researcher's Tent, Little Swamp House) don't exist in the
      // wilderness tool's own vocabulary, so they're re-attached at their
      // original coordinates after every shift — whatever terrain the
      // generator happened to draw there stays as-is, same as any other
      // generated tile.
      const TOTHAL_PRESERVED_TRANSITIONS = {
        map_northern_cliffs: [{ id: 'sp_ncl_tent', label: "Researcher's Tent", col: 35, row: 29, targetMapId: 'map_i_researchers_tent', targetSpotId: 'sp_tent_entry' }],
        map_eastern_mire: [{ id: 'sp_emi_swamp', label: 'Little Swamp House', col: 34, row: 29, targetMapId: 'map_i_swamp_house', targetSpotId: 'sp_swp_entry' }],
      };

      function currentTothalYear() {
        return Math.floor((calendar.day - 1) / (SEASON_LENGTH_DAYS * seasons.length)) + 1;
      }

      function _tothalWorldId() {
        return (window.__hobunjiPlayerProfile || _playerData)?.worldId || null;
      }

      // Reads/writes the Tothal year directly on the world's hobunjiSaveMeta
      // entry — mirrors saveGearInventory()'s pattern of touching localStorage
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

      // ── Livestock (belongs to the world itself, not any character) ─────
      // [{ id, kind, col, row, releasedAt }] — released animals stay on the
      // farm for whoever plays this world, unlike gear/inventory which is
      // scoped to whichever character released them.
      function _loadWorldLivestock() {
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

      // ── Farm ownership / farmhand permissions ─────────────────────────
      // World data (non-gear inventory, NPC relationships, quest progress)
      // stays behind in the world's per-character member record rather than
      // following the character between worlds — the opposite of gear,
      // skills, and stats, which live on the character record and always
      // travel with them. isWorldOwner/farmhandPermissions are decided once
      // at save-select time (onboarding.js) and carried on _playerData for
      // the session; a real farmhand's grants only change between sessions
      // until networking exists to push a live update.
      // Single source of truth for the permission-key set within this file
      // (onboarding.js keeps its own copy — the two closures share no module).
      function defaultFarmhandPermissions() {
        return { storage: false, plant: false, harvest: false, placeFurniture: false, alterFarm: false };
      }

      function defaultWorldMemberState() {
        return { nonGearInventory: {}, packClothing: [], npcRelationships: {}, questProgress: {}, joinedAt: Date.now() };
      }

      function isFarmOwner() {
        if (_debugFarmRoleOverride) return _debugFarmRoleOverride.isOwner;
        return _playerData ? !!_playerData.isWorldOwner : true; // no world context yet — don't lock out solo play
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

      // ── Per-world-per-character data (non-gear inventory, pack, NPC/quest) ──
      // Mirrors saveGearInventory()'s pattern of touching hobunjiSaveMeta
      // directly, but under world.members[characterId] instead of the
      // character record — this is the data that stays behind in the world
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
          member.npcRelationships = npcRelationshipsSnapshot();
          member.questProgress    = { ...questProgress };
          localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
        } catch {}
      }

      // ── Owner/farmhand content visibility ─────────────────────────────
      // Generic gate dialogue trees and (future) quests can tag themselves
      // with: 'owner' (world-owner/protagonist only), 'farmhand' (non-owner
      // members only), or 'any'/omitted (everyone, the default).
      function canAccessContent(visibility) {
        if (!visibility || visibility === 'any') return true;
        if (visibility === 'owner')    return isFarmOwner();
        if (visibility === 'farmhand') return !isFarmOwner();
        return true;
      }

      // ── Quest progress (per world, per character) ─────────────────────
      // No quest content is authored yet — this is the tracking scaffold
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
      // layout — without this, a player who reaches a wilderness zone within
      // the first few seconds of a shift (most likely right at world start)
      // would see last year's map for that visit.
      let _tothalShiftPromise = null;

      // Regenerates all four wilderness zones for the given Tothal year and
      // saves that year to the world file so a reload doesn't reroll again.
      // Seeded from the world id + year + zone, so the same world reliably
      // regrows the same wilderness for that year on every load.
      async function performTothalShift(year) {
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
          for (const zoneId of WildernessMapGenerator.zoneMapIds()) {
            const seed = `${worldId}_tothal_y${year}_${zoneId}`;
            const preserved = TOTHAL_PRESERVED_TRANSITIONS[zoneId] || [];
            let workspace;
            try {
              // Random seed, entry side set per zone — otherwise the tool's own
              // defaults, no post-processing. This is meant to be exactly what
              // a human would get generating a map with the standalone tool and
              // importing it into the Map Editor by hand.
              workspace = WildernessMapGenerator.generateZoneWorkspace(zoneId, seed);
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

            const toTownExit = workspace.entry ? { col: workspace.entry.col, row: workspace.entry.row, label: 'To Hobunji Hollow' } : null;
            _zoneLayouts.set(zoneId, {
              cols: merged.cols, rows: merged.rows, tiles: [...merged.tiles.values()],
              transitions: preserved.map(t => ({ id: t.id, label: t.label, col: t.col, row: t.row, target: 'building', targetMapId: t.targetMapId })),
              toTownExit, mesas: merged.mesas, buildings: merged.buildings || [], decor: [], furniture: [],
            });
            // Entering from town has no authored spawn coordinate of its own
            // (see EXTERIOR_ZONES' comment) — it always falls back to
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
          clearHostileObjects();
          _saveTothalYear(year);
          // showToast is a plain DOM update (no dependency on avatar/gameStarted
          // state), and this can legitimately finish before spawnPlayerAvatar's
          // own async avatar setup does — always show it rather than gating on
          // gameStarted and risking the toast silently getting swallowed by that race.
          showToast('The Tothal Shift has reshaped the wilderness...', true);
          debugLog(`Tothal Shift complete for year ${year}`);
        } finally {
          _tothalShiftInFlight = false;
        }
      }

      // Called at world start and on every day advance — a no-op unless the
      // Tothal year has actually changed since this world last shifted, or
      // ?tothal=force is in the URL (or window.forceTothalShift() was called
      // from devtools) — useful for testing, since a world that already
      // shifted this year otherwise stays untouched on every reload.
      function checkTothalShift(force = false) {
        const year = currentTothalYear();
        const forceQuery = new URLSearchParams(location.search).get('tothal') === 'force';
        if (!force && !forceQuery && _loadTothalYear() === year) return;
        _tothalShiftPromise = performTothalShift(year)
          .catch(e => debugLog('Tothal Shift error: ' + e.message, 'warn'))
          .finally(() => { _tothalShiftPromise = null; });
      }
      window.forceTothalShift = () => checkTothalShift(true);

      // Devtools/QA hook for the cliff-climbing feature — mirrors
      // window.forceTothalShift's role of poking otherwise-input-driven
      // state from a console/automated test.
      window.__climbDebug = {
        getPlayer: () => player,
        getClimbTarget,
        startClimb,
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
      };

      // Ambient hostile spawning — lives entirely inside the exterior zones now
      // (southern cloud forest → Gar-wolf, northern cliffs → Gar-wolf Alpha).
      const HOSTILE_CAP_PER_ZONE = 4;
      const HOSTILE_SPAWN_INTERVAL_S = 14;
      let hostileSpawnTimer = HOSTILE_SPAWN_INTERVAL_S;

      function updateHostileSpawning(dt) {
        if (!_isZoneArea(currentArea)) return;
        hostileSpawnTimer -= dt;
        if (hostileSpawnTimer > 0) return;
        hostileSpawnTimer = HOSTILE_SPAWN_INTERVAL_S;
        const inZone = [...hostileObjects].filter(c => c.areaId === currentArea).length;
        if (inZone >= HOSTILE_CAP_PER_ZONE) return;
        const zdef = EXTERIOR_ZONES[currentArea];
        const zi = buildZoneScene(currentArea);
        if (!zdef || !zi) return;
        for (let attempt = 0; attempt < 8; attempt++) {
          const col = Math.floor(Math.random() * zi.cols);
          const row = Math.floor(Math.random() * zi.rows);
          const x = col * TILE + TILE * 0.5, y = row * TILE + TILE * 0.5;
          if (Math.hypot(x - player.x, y - player.y) < TILE * 5) continue;
          const creature = makeCreatureEntity(zdef.hostileKey, x, y, { homeX: x, homeY: y, state: 'idle' });
          if (creature) hostileObjects.add(creature);
          return;
        }
      }

      function updatePlayerVitals(dt) {
        player.stamina = Math.min(player.maxStamina, player.stamina + PLAYER_STAMINA_REGEN * dt);
        if (player.health > 0) player.health = Math.min(player.maxHealth, player.health + PLAYER_HEALTH_REGEN * dt);
        if (player.dodgeCooldownT > 0) player.dodgeCooldownT = Math.max(0, player.dodgeCooldownT - dt);
        refreshVitalsHud();
      }

      function performDodge(angle) {
        if (player.dodging || player.dodgeCooldownT > 0) return false;
        if (player.stamina < DODGE_STAMINA_COST) {
          showToast('Too winded to dodge!', false);
          return false;
        }
        player.stamina -= DODGE_STAMINA_COST;
        player.dodging = true;
        player.dodgeT = DODGE_DUR_S;
        player.dodgeDirX = Math.cos(angle);
        player.dodgeDirY = Math.sin(angle);
        player.dodgeCooldownT = DODGE_COOLDOWN_S;
        player.invulnUntil = performance.now() + DODGE_IFRAME_MS;
        return true;
      }

      // Combat-ability movement: a short forward step/leap toward the aim
      // direction (player.angle), layered under an attack's own windup/
      // strike timing — distinct from performDodge's evasive zip above.
      // distancePx is total ground covered over durationS (eased out, so it's
      // fast at first and settles in); hopUnits is an optional cosmetic
      // vertical arc peak in world-Y units for a leaping attack.
      function beginCombatLunge(distancePx, durationS, hopUnits = 0) {
        if (durationS <= 0 || distancePx <= 0) return;
        player.lunging = true;
        player.lungeT = durationS;
        player.lungeDur = durationS;
        player.lungeStartX = player.x;
        player.lungeStartY = player.y;
        player.lungeDirX = Math.cos(player.angle);
        player.lungeDirY = Math.sin(player.angle);
        player.lungeDistancePx = distancePx;
        player.lungeHopUnits = hopUnits;
      }

      const _vbHealthFill  = document.getElementById('vbHealthFill');
      const _vbStaminaFill = document.getElementById('vbStaminaFill');
      function refreshVitalsHud() {
        if (_vbHealthFill)  _vbHealthFill.style.width  = `${Math.max(0, Math.min(100, player.health  / player.maxHealth  * 100))}%`;
        if (_vbStaminaFill) _vbStaminaFill.style.width = `${Math.max(0, Math.min(100, player.stamina / player.maxStamina * 100))}%`;
      }

      // ── World travel: transition spots + shared NPC routes (map editor data) ─
      // Authored in docs/tools/map-editor and carried in hobunji_farm_layout_v3
      // as `transitions`, `routes`, and legacy `npcPaths`. area: 'farm' | 'interior'.
      let worldTransitions     = [];   // farm+interior: { id, label, area, col, row, target, targetCol, targetRow }
      let worldTownTransitions = [];   // town: same shape
      let worldRoutes          = [];   // shared routes: { id, label, area, nodes: [[c,r],...] }
      let worldTownRoutes      = [];   // town shared routes
      const npcStationsById    = new Map(); // stationId → { id, label, area, c, r, rotY, pose, toolKey, toolIntervalSec }
      let worldNpcPaths        = [];   // legacy only: { id, label, npcId, area, nodes: [[c,r],...] }
      const routeGraphsByArea  = new Map();
      const npcWalkers         = [];
      window._npcWalkers = npcWalkers;
      let dialogueOpen       = false;
      let _dialogueLines     = [];
      let _dialogueLineIdx   = 0;
      let _dialogueWalker    = null;
      let _npcDialogueTypeTimer = null;
      let _npcDialogueTypeText  = '';
      let _npcDialogueTypeIndex = 0;
      let _playerData        = null;  // set from hobunjiPlayerReady event
      let playerAvatarRefreshGeneration = 0; // Guards async avatar rebuilds from attaching stale planes.
      // The base attach point updateToolMesh hangs tools/weapons from. X is the avatar's
      // actual scanned right-arm sprite edge; Y is the avatar's actual scanned bottom-edge
      // pixel row (these are cropped bust-style portraits, so the bottom-most opaque pixel
      // is hand height, not avatarHeight/2 — see handAttachY in png-plane-avatar.js). Both
      // vary by species and are recomputed in refreshPlayerAvatar() once the per-species
      // sprite/scale is known.
      let playerToolBaseX = -0.45, playerToolBaseY = 0.45;

      // ── Dialogue tree runtime state ──────────────────────────────────
      let _dlgTree      = null;  // active tree object
      let _dlgNodeMap   = null;  // {id → node}
      let _dlgNode      = null;  // current node
      let _dlgNpcRec    = null;  // current NPC record
      let _dlgSeqStack  = [];    // [{seqNodeId, depthRemaining}]
      const _npcDlgState = new Map(); // npcId → {visitedSeqSlots:{seqId:[slotIdx,...]}, localNickname}
      let npcDialogueStaging = null;
      let activeCameraMode   = cameraConfig().defaultMode || 'default';
      let activeCameraTarget = null;
      let _prevCameraMode    = null; // saved mode to restore when the fishing minigame closes
      let _prevCameraTarget  = null; // saved target to restore when the fishing minigame closes
      // Mobile drag-to-look offsets, layered on top of the active mode's base
      // azimuth/angle. Clamped tightly (±45°) since this is a look-around nudge,
      // not a free-orbit camera.
      let cameraAzimuthOffsetDeg = 0;
      let cameraAngleOffsetDeg   = 0;
      // Reused every frame by occlusionSafeCameraPosition — a fresh
      // THREE.Raycaster per call would just be needless per-frame garbage.
      const _cameraOcclusionRaycaster = new THREE.Raycaster();
      // Camera azimuth (radians, rotated from due-south toward east) for the active
      // mode. Everything except "fishing" stays at 0 (camera due south, as before).
      function activeCameraAzimuthRad() {
        return THREE.MathUtils.degToRad((cameraModeConfig(activeCameraMode).azimuthDeg ?? 0) + cameraAzimuthOffsetDeg);
      }
      // Billboard sprites go edge-on (and effectively disappear) when rotated
      // perpendicular to the camera's current viewing axis. perpClamp's dead zones
      // need to rotate along with the camera's azimuth so this still works once the
      // camera isn't pointed due north (e.g. the "fishing" mode's diagonal framing).
      function cameraRelativePerps() {
        const az = activeCameraAzimuthRad();
        return [Math.PI / 2 + az, -Math.PI / 2 + az];
      }
      // Creatures (buildAnimalPlaneAvatarModel) use a side-view two-plane sprite, the
      // opposite convention from the front-facing player/NPC sprite: they go edge-on
      // when facing straight toward/away from the camera (group rotation 0/PI), not
      // when broadside to it. So their dead zones center on those angles instead.
      function cameraRelativeCreaturePerps() {
        const az = activeCameraAzimuthRad();
        return [0 + az, Math.PI + az];
      }
      function nearestAngleAmong(current, candidates) {
        let best = candidates[0], bestAbs = Infinity;
        for (const c of candidates) {
          const a = Math.abs(angleDiff(c, current));
          if (a < bestAbs) { bestAbs = a; best = c; }
        }
        return best;
      }
      // updateCreatureMesh derives a creature's group rotation from an aimAngle via
      // rawTargetRotY = -(aimAngle) + PI/2; this inverts that to get the aimAngle
      // that would produce a desired group-rotation-Y.
      function creatureAimAngleForGroupRot(groupRotY) {
        return Math.PI / 2 - groupRotY;
      }
      // Idle creatures with no explicit look target settle broadside to the camera
      // (cameraRelativePerps — full side profile visible) instead of holding
      // whatever direction they last moved in.
      function idleCreatureAimAngle(currentGroupRotY) {
        const broadside = nearestAngleAmong(currentGroupRotY, cameraRelativePerps());
        return creatureAimAngleForGroupRot(broadside);
      }
      let dialogueCameraZoomPercent = cameraModeConfig(npcDialogueCameraMode()).runtimeZoom?.initialPercent ?? 0;
      const dialogueZoomPointers = new Map();
      let dialoguePinchDistance = null;
      let nearbyNpcWalker    = null;
      let _transitionLatch     = null; // 'area:c,r' — player must leave this tile before spots re-arm
      let _pendingSpotTransition = null; // spot the player is currently standing on; awaits input to fire
      // ── Town zone ──────────────────────────────────────────────────
      let _townZone          = null;   // parsed hobunji_town_v1 layout
      let townGrid           = [];     // 2-D tile array for the town map
      let townScene          = null;   // THREE.Scene, built lazily
      let townAmbientLight   = null;
      let townSunLight       = null;
      let _townSceneBuilt    = false;
      let _townBuildingDefs  = [];     // building entries from _townZone.buildings
      let _townBuildingGroups = [];    // { group, bldg, piece, wbOpts, wbGableOpts }[]
      const _buildingScenes = new Map(); // mapId → { scene, grid, cols, rows, transitions } | null
      let _currentBuildingMapId = null;
      let _pendingEntrySpawnFromExit = false; // true when enterBuilding fired before scene loaded
      let _workspaceMaps = null;       // all maps from town-workspace-v1.json, cached for building interiors
      function _isBuildingArea(area) { return typeof area === 'string' && area.startsWith('map_i_'); }
      // ── Exterior zones (Northern Cliffs / Southern Cloud Forest) ──────
      const _zoneScenes = new Map(); // mapId → { scene, grid, cols, rows, transitions }
      // mapId → { cols, rows, tiles: [{c,r,type}], transitions, buildings, decor,
      // furniture } — real authored map data resolved from town-workspace-v1.json
      // by _loadTownFromWorkspace(), used in place of EXTERIOR_ZONES' tiny flat
      // placeholder grid whenever it's available. `buildings`/`decor`/`furniture`
      // entries already carry world-space col/row (folded through the same
      // plateau-stack offset every tile goes through) and a resolved elevTier
      // looked up at that anchor cell — see mergeZoneTiles.
      const _zoneLayouts = new Map();
      // mapId → [{ group, bldg, piece, wbOpts, wbGableOpts }] — mirrors
      // _townBuildingGroups but per zone map; see _spawnZoneBuildings.
      const _zoneBuildingGroups = new Map();
      // mapId → [THREE.Object3D, ...] (meshes + point lights) — decor/processing
      // furniture props spawned for a zone map; see _spawnZoneDecorFurniture.
      const _zoneDecorFurnitureGroups = new Map();
      // mapId → [THREE.Mesh, ...] (animated waterfall curtain meshes) — see
      // buildWaterfallCurtainMeshes/updateZoneWaterMeshes. Mirrors
      // _townRiverWaterMeshes but per zone map, since a zone's water tiles never
      // share the town's flat single-tier grid.
      const _zoneWaterMeshes = new Map();
      // mapIds whose _zoneLayouts entry was replaced by a Tothal Shift (see
      // performTothalShift) while the player was standing inside that same
      // zone — rebuilding the live THREE.Scene out from under them mid-visit
      // would drop them through changed terrain, so the stale cached scene is
      // left alone and only torn down (via _disposeZoneScene, in
      // buildZoneScene) the next time that map is entered fresh.
      const _dirtyZoneScenes = new Set();
      // Surface Y for a tile actually standing inside an exterior zone. Plateau
      // sub-maps are purely an authoring convenience in the Map Editor — in-game
      // every tier of a plateau stack is merged into its root zone's single grid,
      // so each tile itself (not the zone as a whole) carries its own absolute
      // elevation tier (tile.elevTier, set by _loadTownFromWorkspace's recursive
      // merge). Authored ramp tiles use their own absolute rampElevation instead,
      // so players/creatures crossing a ramp follow its slope rather than snapping
      // to a flat tier height.
      function tileSurfaceYInArea(tile, areaId) {
        if (tile && tile.type === TileType.RAMP) return NORMAL_TOP + (tile.rampElevation || 0) * PLATEAU_UNIT;
        return tileSurfaceY(tile ? tile.type : TileType.GRASS) + (tile?.elevTier || 0) * PLATEAU_UNIT;
      }

      const _audioCueIndexes = new Map();
      const _mapAudioIndexes = new Map();
      let _ambientCueState = { area: '', indexId: '', mode: 'bgm', nextAt: 0, currentCue: null, currentBgm: null };
      const _furnitureSfxSources = [];
      const _loopingBgs = new Map();
      const _audioDebugLast = new Map();
      const _gameAudioElements = new Set();
      let _gameAudioUnlocked = false;
      const _audioFailedUrls = new Set();
      const _dailyBgmPlayed = new Set();
      let _musicAudioCtx = null;
      const _musicGainNodes = new Map();       // music <audio> element -> { ctx, gain, target }
      const _musicLoudnessGain = new Map();    // resolved track url -> measured normalization multiplier
      const _musicLoudnessPending = new Map(); // resolved track url -> in-flight analysis promise
      const MUSIC_TARGET_RMS = 0.16;
      const MUSIC_LOUDNESS_GAIN_MIN = 0.5;
      const MUSIC_LOUDNESS_GAIN_MAX = 2.2;

      function audioDebug(message, key = message, throttleMs = 1200, category = 'audio') {
        const now = performance.now();
        const last = _audioDebugLast.has(key) ? _audioDebugLast.get(key) : -Infinity;
        if (now - last < throttleMs) return;
        _audioDebugLast.set(key, now);
        debugLog(message, category);
      }

      function audioTraceEnabled() {
        return window.SCRATCHBONES_CONFIG?.game?.debug?.trace?.audio !== false;
      }

      function audioTrace(message, key = message, throttleMs = 2000, category = 'audio') {
        if (!audioTraceEnabled()) return;
        audioDebug(message, key, throttleMs, category);
      }

      function resolveAudioUrl(url) {
        if (!url) return '';
        try { return new URL(url, document.baseURI).href; }
        catch { return url; }
      }

      function audioReadyStateLabel(snd) {
        const labels = ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA'];
        return labels[snd?.readyState] || String(snd?.readyState ?? 'none');
      }

      function makeGameAudio(url, { loop = false, preload = 'auto' } = {}) {
        const snd = new Audio(resolveAudioUrl(url));
        snd.loop = !!loop;
        snd.preload = preload;
        snd.addEventListener('loadstart', () => audioTrace('loadstart ' + snd.src, 'media-loadstart-' + snd.src, 0), { once: true });
        snd.addEventListener('canplaythrough', () => audioTrace('canplaythrough ' + snd.src + ' ready=' + audioReadyStateLabel(snd), 'media-canplay-' + snd.src, 0), { once: true });
        snd.addEventListener('error', () => audioDebug('media error ' + snd.src + ' code=' + (snd.error?.code || 'none') + ' message=' + (snd.error?.message || ''), 'media-error-' + snd.src, 0));
        _gameAudioElements.add(snd);
        try { snd.load(); } catch {}
        return snd;
      }

      function getMusicAudioCtx() {
        if (_musicAudioCtx) return _musicAudioCtx;
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        try { _musicAudioCtx = new AudioCtx(); }
        catch (e) { audioDebug('music audio context unavailable: ' + (e?.message || e), 'music-ctx-fail', 0); _musicAudioCtx = null; }
        return _musicAudioCtx;
      }

      // Routes a music <audio> element through a GainNode so it can be faded
      // smoothly and boosted past the element's volume<=1 ceiling (needed to
      // normalize quiet tracks up to the target level). Falls back to plain
      // `snd.volume` (capped at 1, no boosting) if Web Audio is unavailable.
      function attachMusicGain(snd) {
        const ctx = getMusicAudioCtx();
        if (!ctx) return null;
        if (_musicGainNodes.has(snd)) return _musicGainNodes.get(snd);
        try {
          const source = ctx.createMediaElementSource(snd);
          const gain = ctx.createGain();
          gain.gain.value = 0;
          source.connect(gain).connect(ctx.destination);
          const node = { ctx, gain, target: 0 };
          _musicGainNodes.set(snd, node);
          return node;
        } catch (e) {
          audioDebug('music gain attach failed ' + snd.src + ': ' + (e?.message || e), 'music-gain-attach-fail', 0);
          return null;
        }
      }

      function releaseMusicGain(snd) {
        const node = _musicGainNodes.get(snd);
        if (node) { try { node.gain.disconnect(); } catch {} }
        _musicGainNodes.delete(snd);
      }

      function setMusicVolumeNow(snd, value) {
        const v = Math.max(0, value);
        const node = _musicGainNodes.get(snd);
        const clampedTarget = Math.max(0, Math.min(1, v));
        if (node) {
          node.target = v;
          node.gain.gain.cancelScheduledValues(node.ctx.currentTime);
          node.gain.gain.setValueAtTime(v, node.ctx.currentTime);
          // The element's own .volume no longer affects audible output once
          // routed through the GainNode, but unlockGameAudio()'s retry loop
          // still reads it to tell "should be audible" apart from
          // "intentionally silent/stopped" — keep it mirroring the target.
          snd.volume = clampedTarget;
        } else {
          snd.volume = clampedTarget;
        }
      }

      // Ramps a music element's volume to `target` over `durationMs`. Uses
      // Web Audio gain automation when available (immune to rAF/timer jitter),
      // and a rAF-driven fallback on `.volume` otherwise. `onDone` fires once
      // this specific ramp completes (skipped if a later fade supersedes it).
      function fadeMusicVolume(snd, target, durationMs, onDone) {
        const v = Math.max(0, target);
        const dur = Math.max(0, Number(durationMs) || 0);
        const clampedTarget = Math.max(0, Math.min(1, v));
        const node = _musicGainNodes.get(snd);
        if (node) {
          node.target = v;
          const now = node.ctx.currentTime;
          node.gain.gain.cancelScheduledValues(now);
          node.gain.gain.setValueAtTime(node.gain.gain.value, now);
          if (dur <= 0) node.gain.gain.setValueAtTime(v, now);
          else node.gain.gain.linearRampToValueAtTime(v, now + dur / 1000);
          // Mirror the *target* onto .volume immediately (not waiting for the
          // ramp) — it no longer drives audible output once routed through
          // the GainNode, but unlockGameAudio()'s retry loop reads it to know
          // whether a paused element wants to be playing.
          snd.volume = clampedTarget;
          if (onDone) setTimeout(() => { if (node.target === v) onDone(); }, dur);
          return;
        }
        if (dur <= 0) { snd.volume = clampedTarget; onDone?.(); return; }
        const start = snd.volume;
        const startTime = performance.now();
        const token = {};
        snd._fadeToken = token;
        const step = now => {
          if (snd._fadeToken !== token) return;
          const t = Math.min(1, (now - startTime) / dur);
          snd.volume = start + (clampedTarget - start) * t;
          if (t < 1) requestAnimationFrame(step);
          else onDone?.();
        };
        requestAnimationFrame(step);
      }

      function computeAudioBufferRms(buffer) {
        let sumSquares = 0, count = 0;
        const step = Math.max(1, Math.floor(buffer.sampleRate / 4000));
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
          const data = buffer.getChannelData(ch);
          for (let i = 0; i < data.length; i += step) { sumSquares += data[i] * data[i]; count++; }
        }
        return count ? Math.sqrt(sumSquares / count) : 0;
      }

      // Lazily measures a track's loudness via Web Audio and caches a gain
      // multiplier that brings it to MUSIC_TARGET_RMS, so songs/cues recorded
      // or mastered at different levels come out at a consistent perceived
      // volume automatically, without hand-tuning each file's `volume` field.
      function musicLoudnessGain(url) {
        const resolved = resolveAudioUrl(url);
        if (!resolved) return Promise.resolve(1);
        if (_musicLoudnessGain.has(resolved)) return Promise.resolve(_musicLoudnessGain.get(resolved));
        if (_musicLoudnessPending.has(resolved)) return _musicLoudnessPending.get(resolved);
        const ctx = getMusicAudioCtx();
        if (!ctx) return Promise.resolve(1);
        const promise = fetch(resolved)
          .then(res => res.arrayBuffer())
          .then(buf => ctx.decodeAudioData(buf))
          .then(audioBuf => {
            const rms = computeAudioBufferRms(audioBuf);
            const gain = rms > 0.0001 ? clamp(MUSIC_TARGET_RMS / rms, MUSIC_LOUDNESS_GAIN_MIN, MUSIC_LOUDNESS_GAIN_MAX) : 1;
            _musicLoudnessGain.set(resolved, gain);
            audioDebug('measured loudness url=' + resolved + ' rms=' + rms.toFixed(4) + ' gain=' + gain.toFixed(2), 'music-loudness-' + resolved, 0);
            return gain;
          })
          .catch(e => {
            audioDebug('loudness analysis failed url=' + resolved + ': ' + (e?.message || e), 'music-loudness-fail-' + resolved, 0);
            _musicLoudnessGain.set(resolved, 1);
            return 1;
          })
          .finally(() => _musicLoudnessPending.delete(resolved));
        _musicLoudnessPending.set(resolved, promise);
        return promise;
      }

      function musicFadeConfig() {
        const audioCfg = gameAudioConfig();
        return {
          songFadeInMs: Math.max(0, Number(audioCfg.songFadeInMs) || 2200),
          songFadeOutMs: Math.max(0, Number(audioCfg.songFadeOutMs) || 2600),
          cueFadeMs: Math.max(0, Number(audioCfg.musicFadeMs) || 280),
          interruptFadeMs: Math.max(0, Number(audioCfg.musicFadeMs) || 280)
        };
      }

      // Plays a music track (BGM song or ambient cue) with automatic loudness
      // normalization and a fade-in at the start / fade-out before it ends
      // naturally. `baseVolume` is the pre-normalization target (0..1) from
      // config; the measured loudness multiplier is layered on top once the
      // (cached, async) analysis resolves. Returns the <audio> element, with
      // a `_stopMusic(fadeMs)` helper attached for fading out an interruption
      // (e.g. switching areas) instead of cutting the track off mid-note.
      function playMusicTrack(url, baseVolume, fadeInMs, fadeOutMs) {
        const snd = makeGameAudio(url);
        attachMusicGain(snd);
        setMusicVolumeNow(snd, 0);
        let fadingOut = false;
        const targetVolume = () => Math.max(0, baseVolume) * (_musicLoudnessGain.get(resolveAudioUrl(url)) ?? 1);
        fadeMusicVolume(snd, targetVolume(), fadeInMs);
        musicLoudnessGain(url).then(() => {
          if (!fadingOut && !snd.paused) fadeMusicVolume(snd, targetVolume(), 400);
        });
        if (fadeOutMs > 0) {
          snd.addEventListener('timeupdate', () => {
            if (fadingOut) return;
            const remaining = (snd.duration || 0) - snd.currentTime;
            if (Number.isFinite(remaining) && remaining > 0 && remaining <= fadeOutMs / 1000) {
              fadingOut = true;
              fadeMusicVolume(snd, 0, remaining * 1000);
            }
          });
        }
        snd._stopMusic = (stopFadeMs = fadeOutMs) => new Promise(resolve => {
          fadingOut = true;
          fadeMusicVolume(snd, 0, stopFadeMs, () => { snd.pause(); releaseMusicGain(snd); resolve(); });
        });
        // Some decode failures never surface as an 'error' event: the element
        // reports paused=false (and the gain ramp completes normally) but
        // currentTime never advances — silently stuck forever with nothing
        // for a caller's 'error' listener to catch. Lets callers detect that
        // and recover instead of leaving the track stuck mute indefinitely.
        snd._watchForStall = (timeoutMs, onStalled) => {
          setTimeout(() => {
            if (fadingOut || snd.paused || snd.ended) return;
            if (snd.currentTime > 0.05) return;
            onStalled();
          }, timeoutMs);
        };
        return snd;
      }

      function markAudioUrlFailed(url, reason) {
        const resolved = resolveAudioUrl(url);
        if (!resolved) return;
        _audioFailedUrls.add(resolved);
        audioDebug('marked audio failed url=' + resolved + ' reason=' + reason, 'audio-failed-' + resolved, 0);
      }

      function audioUrlFailed(url) {
        const resolved = resolveAudioUrl(url);
        return !!resolved && _audioFailedUrls.has(resolved);
      }

      function describeAudioConfigForArea(area) {
        const audioCfg = gameAudioConfig();
        const bgs = audioCfg.bgs || {};
        audioTrace('config area=' + area + ' enabled=' + (audioCfg.enabled !== false) + ' bgmCount=' + ((audioCfg.areaBgm?.[area] || []).length) + ' bgs birds=' + !!bgs.birds + ' nightbugs=' + !!bgs.nightbugs + ' wind1=' + !!bgs.wind1 + ' wind2=' + !!bgs.wind2, 'audio-config-' + area, 5000);
      }

      function unlockGameAudio(reason = 'user gesture') {
        // Resuming suspended AudioContexts must happen on every gesture, not just
        // the first: _musicAudioCtx/_rainAudioCtx are created lazily (the first
        // time music or rain actually tries to play), which is often well after
        // the player's first click/tap — by which point a one-shot unlock would
        // already be spent and the newly-created context would stay suspended
        // (silently) forever.
        const rainCtx = window._rainAudioCtx;
        if (rainCtx?.state === 'suspended') rainCtx.resume().catch(err => audioDebug('rain audio resume failed: ' + (err?.name || err), 'rain-resume-fail', 0));
        if (_musicAudioCtx?.state === 'suspended') _musicAudioCtx.resume().catch(err => audioDebug('music audio resume failed: ' + (err?.name || err), 'music-resume-fail', 0));
        if (!_gameAudioUnlocked) {
          _gameAudioUnlocked = true;
          audioDebug('audio unlock from ' + reason, 'audio-unlock', 0);
        }
        // Retry blocked playback on every gesture, not just the first: every
        // bgm/cue track is a freshly-created <audio> element (see
        // playMusicTrack), so a track that starts well after the player's
        // first click/tap can still get autoplay-blocked and needs its own
        // later gesture to retry play() — a one-shot retry only ever catches
        // whatever happened to be paused at that first moment.
        for (const snd of _gameAudioElements) {
          if (!snd || snd.volume <= 0 || !snd.paused) continue;
          snd.play().then(() => {
            audioTrace('unlock replay started ' + snd.src, 'unlock-play-' + snd.src, 0);
          }).catch(err => {
            audioDebug('unlock replay blocked/failed ' + snd.src + ': ' + (err?.name || err), 'unlock-fail-' + snd.src, 0);
          });
        }
      }

      document.addEventListener('pointerdown', () => unlockGameAudio('pointerdown'), { capture: true });
      document.addEventListener('keydown', () => unlockGameAudio('keydown'), { capture: true });
      document.addEventListener('touchstart', () => unlockGameAudio('touchstart'), { capture: true, passive: true });

      async function loadAudioCueIndexes() {
        try {
          const res = await fetch('assets/audio/music/cues/index.json');
          if (!res.ok) return;
          const registry = await res.json();
          await Promise.all((registry.indexes || []).map(async entry => {
            if (!entry?.id || !entry.file) return;
            const r = await fetch(entry.file);
            if (!r.ok) return;
            const data = await r.json();
            data.__basePath = entry.file.replace(/[^/]+$/, '');
            _audioCueIndexes.set(entry.id, data);
            audioDebug('loaded cue index ' + entry.id + ' (' + ((data.ambient_cues || []).length) + ' cues)', 'cue-index-' + entry.id, 0, 'cue');
          }));
        } catch(e) { debugLog('Audio cue index load failed: ' + e.message, 'warn'); }
      }

      function registerMapAudio(entries) {
        for (const e of (entries || [])) {
          const area = e.area || e.mapId;
          if (area && e.audioIndex) _mapAudioIndexes.set(area, e.audioIndex);
        }
      }

      function resolveAreaAudioIndex(area) {
        if (area === 'farm' || area === 'town') return 'general';
        if (_mapAudioIndexes.has(area)) return _mapAudioIndexes.get(area);
        if (_isZoneArea(area)) return EXTERIOR_ZONES[area].audioIndex || '';
        const wsMap = _workspaceMaps?.find(m => (m.id === area) || (area === 'town' && m.id === 'map_hobunji_town'));
        return wsMap?.audioIndex || '';
      }

      function resetAmbientCueTimer(area = currentArea) {
        _ambientCueState.area = area;
        _ambientCueState.indexId = resolveAreaAudioIndex(area);
        _ambientCueState.mode = 'bgm';
        _ambientCueState.nextAt = 0;
        audioDebug('ambient area=' + area + ' cueIndex=' + (_ambientCueState.indexId || 'none') + ' mode=bgm', 'ambient-area-' + area, 0, 'bgm');
        describeAudioConfigForArea(area);
      }

      function stopAmbientCue() {
        const fade = musicFadeConfig();
        for (const key of ['currentCue', 'currentBgm']) {
          const snd = _ambientCueState[key];
          _ambientCueState[key] = null;
          if (!snd) continue;
          if (snd._stopMusic) snd._stopMusic(fade.interruptFadeMs);
          else snd.pause();
        }
      }

      function isNightTime() {
        const hour = getHour();
        return hour < 7 || hour >= 19;
      }

      function bgmDailyKey(track) {
        return calendar.day + ':' + resolveAudioUrl(track?.url || '');
      }

      function isSunriseBgmEligible(track) {
        if (!track?.sunriseOnly) return true;
        const sunriseHour = Number.isFinite(Number(track.sunriseHour)) ? Number(track.sunriseHour) : MORNING_HOUR;
        const windowHours = Math.max(0, Number(track.sunriseWindowHours) || 0);
        const hour = getHour();
        return hour >= sunriseHour && hour < sunriseHour + windowHours;
      }

      function isBgmTrackEligible(track) {
        if (!track?.url) return false;
        if (track.nightOnly && !isNightTime()) return false;
        if (!isSunriseBgmEligible(track)) return false;
        if (track.oncePerDay && _dailyBgmPlayed.has(bgmDailyKey(track))) return false;
        return !audioUrlFailed(track.url);
      }

      function resolveAreaBgm(area) {
        const sets = gameAudioConfig().areaBgm || {};
        const all = (sets[area] || []).filter(track => track?.url);
        const playable = all.filter(isBgmTrackEligible);
        if (!playable.length) {
          if (all.length) audioDebug('no eligible bgm candidates for area=' + area + '; waiting for time window or valid media', 'bgm-all-failed-' + area, 3000, 'bgm');
          return null;
        }
        const preferred = playable.filter(track => !track.fallback);
        const list = preferred.length ? preferred : playable;
        return list[Math.floor(Math.random() * list.length)] || null;
      }

      function scheduleNextCueDelay() {
        const audioCfg = gameAudioConfig();
        const minSec = Number(audioCfg.ambientCueMinDelaySec) || 300;
        const maxSec = Math.max(minSec, Number(audioCfg.ambientCueMaxDelaySec) || 600);
        _ambientCueState.nextAt = performance.now() + (minSec + Math.random() * (maxSec - minSec)) * 1000;
      }

      function updateAmbientCues() {
        const audioCfg = gameAudioConfig();
        if (audioCfg.enabled === false) { audioTrace('ambient disabled by config', 'ambient-disabled', 3000); return; }
        if (_ambientCueState.area !== currentArea) { stopAmbientCue(); resetAmbientCueTimer(currentArea); }
        const idx = _audioCueIndexes.get(_ambientCueState.indexId);
        const cues = idx?.ambient_cues || [];
        audioTrace('ambient state area=' + currentArea + ' mode=' + _ambientCueState.mode + ' index=' + (_ambientCueState.indexId || 'none') + ' cues=' + cues.length + ' bgmActive=' + !!_ambientCueState.currentBgm + ' cueActive=' + !!_ambientCueState.currentCue + ' nextInMs=' + Math.max(0, Math.round((_ambientCueState.nextAt || 0) - performance.now())), 'ambient-state-' + currentArea, 5000);
        if (_ambientCueState.currentCue && !_ambientCueState.currentCue.ended) return;
        if (_ambientCueState.currentCue?.ended) _ambientCueState.currentCue = null;

        if (_ambientCueState.mode === 'cue_wait') {
          if (performance.now() < _ambientCueState.nextAt) return;
          if (!cues.length) { _ambientCueState.mode = 'bgm'; return; }
          const cue = cues[Math.floor(Math.random() * cues.length)];
          if (!cue?.file) { scheduleNextCueDelay(); return; }
          const fade = musicFadeConfig();
          const cueUrl = (idx.__basePath || '') + cue.file;
          const cueBaseVolume = Math.max(0, Math.min(1, Number(cue.volume) || Number(audioCfg.bgmVolume) || 0.7));
          const snd = playMusicTrack(cueUrl, cueBaseVolume, fade.cueFadeMs, fade.cueFadeMs);
          const finishCue = () => {
            if (_ambientCueState.currentCue === snd) _ambientCueState.currentCue = null;
            releaseMusicGain(snd);
            _ambientCueState.mode = 'bgm';
          };
          snd.addEventListener('ended', finishCue, { once: true });
          snd.addEventListener('error', () => { audioDebug('cue error ' + snd.src, 'cue-error-' + cue.id, 0, 'cue'); finishCue(); }, { once: true });
          snd._watchForStall(6000, () => {
            if (_ambientCueState.currentCue !== snd) return;
            audioDebug('cue stalled (no playback progress) ' + snd.src, 'cue-stall-' + cue.id, 0, 'cue');
            finishCue();
          });
          _ambientCueState.currentCue = snd;
          audioDebug('playing cue area=' + currentArea + ' id=' + cue.id + ' url=' + snd.src + ' baseVolume=' + cueBaseVolume.toFixed(2), 'cue-play-' + cue.id, 0, 'cue');
          snd.play().catch(err => {
            audioDebug('cue play blocked/failed id=' + cue.id + ': ' + (err?.name || err), 'cue-fail-' + cue.id, 0, 'cue');
            releaseMusicGain(snd);
            _ambientCueState.currentCue = null;
            _ambientCueState.mode = 'cue_wait';
            _ambientCueState.nextAt = performance.now() + 3000;
          });
          return;
        }

        if (_ambientCueState.currentBgm && !_ambientCueState.currentBgm.ended) return;
        _ambientCueState.currentBgm = null;
        if (performance.now() < _ambientCueState.nextAt) return;
        const bgmTrack = resolveAreaBgm(currentArea);
        const bgmUrl = bgmTrack?.url || '';
        if (!bgmUrl) { audioDebug('no eligible bgm for area=' + currentArea + '; retrying bgm resolution soon', 'bgm-missing-' + currentArea, 3000, 'bgm'); _ambientCueState.mode = 'bgm'; _ambientCueState.nextAt = performance.now() + 5000; return; }
        const fade = musicFadeConfig();
        const bgmBaseVolume = Math.max(0, Math.min(1, Number(audioCfg.bgmVolume) || 0.48));
        const snd = playMusicTrack(bgmUrl, bgmBaseVolume, fade.songFadeInMs, fade.songFadeOutMs);
        const finishBgm = () => {
          if (_ambientCueState.currentBgm === snd) _ambientCueState.currentBgm = null;
          releaseMusicGain(snd);
          _ambientCueState.mode = 'cue_wait';
          scheduleNextCueDelay();
        };
        snd.addEventListener('ended', finishBgm, { once: true });
        snd.addEventListener('error', () => { audioDebug('bgm error ' + snd.src, 'bgm-error-' + bgmUrl, 0, 'bgm'); markAudioUrlFailed(bgmUrl, 'media error'); releaseMusicGain(snd); if (_ambientCueState.currentBgm === snd) _ambientCueState.currentBgm = null; _ambientCueState.mode = 'bgm'; _ambientCueState.nextAt = performance.now() + 1000; }, { once: true });
        snd._watchForStall(6000, () => {
          if (_ambientCueState.currentBgm !== snd) return;
          // Not marked failed (unlike the 'error' case above) — a stall can
          // be a transient slow-load/decode hiccup rather than a permanently
          // broken file, and blacklisting would wrongly exclude it forever.
          audioDebug('bgm stalled (no playback progress) ' + snd.src, 'bgm-stall-' + currentArea + '-' + bgmUrl, 0, 'bgm');
          releaseMusicGain(snd);
          _ambientCueState.currentBgm = null;
          _ambientCueState.mode = 'bgm';
          _ambientCueState.nextAt = performance.now() + 1000;
          snd.pause();
        });
        _ambientCueState.currentBgm = snd;
        audioDebug('playing bgm area=' + currentArea + ' url=' + snd.src + ' baseVolume=' + bgmBaseVolume.toFixed(2), 'bgm-play-' + currentArea + '-' + bgmUrl, 0, 'bgm');
        snd.play().then(() => {
          if (bgmTrack?.oncePerDay) {
            _dailyBgmPlayed.add(bgmDailyKey(bgmTrack));
            audioDebug('marked once-per-day bgm played url=' + snd.src + ' day=' + calendar.day, 'bgm-daily-' + bgmDailyKey(bgmTrack), 0, 'bgm');
          }
        }).catch(err => {
          audioDebug('bgm play blocked/failed area=' + currentArea + ': ' + (err?.name || err), 'bgm-fail-' + currentArea, 0, 'bgm');
          if ((err?.name || '') !== 'NotAllowedError') markAudioUrlFailed(bgmUrl, err?.name || err || 'play failed');
          releaseMusicGain(snd);
          if (_ambientCueState.currentBgm === snd) _ambientCueState.currentBgm = null;
          _ambientCueState.mode = 'bgm';
          _ambientCueState.nextAt = performance.now() + 1000;
        });
      }

      function setLoopingBgs(id, url, volume) {
        const v = Math.max(0, Math.min(1, Number(volume) || 0));
        let snd = _loopingBgs.get(id);
        if (!snd && url) {
          snd = makeGameAudio(url, { loop: true });
          _loopingBgs.set(id, snd);
        }
        if (!snd) return;
        snd.volume = v;
        audioTrace('bgs state ' + id + ' volume=' + v.toFixed(2) + ' paused=' + snd.paused + ' ready=' + audioReadyStateLabel(snd) + ' url=' + snd.src, 'bgs-state-' + id, 5000, 'bgs');
        if (v > 0 && snd.paused) {
          audioDebug('starting bgs ' + id + ' url=' + snd.src + ' volume=' + v.toFixed(2), 'bgs-start-' + id, 0, 'bgs');
          snd.play().catch(err => audioDebug('bgs play blocked/failed ' + id + ': ' + (err?.name || err), 'bgs-fail-' + id, 0, 'bgs'));
        }
        if (v <= 0 && !snd.paused) {
          audioDebug('stopping bgs ' + id, 'bgs-stop-' + id, 0, 'bgs');
          snd.pause();
        }
      }

      function updateExteriorBgs() {
        const audioCfg = gameAudioConfig();
        if (audioCfg.enabled === false) {
          audioDebug('exterior bgs disabled by config', 'bgs-disabled', 1200, 'bgs');
          setLoopingBgs('birds', '', 0);
          setLoopingBgs('nightbugs', '', 0);
          setLoopingBgs('wind1', '', 0);
          setLoopingBgs('wind2', '', 0);
          return;
        }
        const bgs = audioCfg.bgs || {};
        const exterior = currentArea === 'farm' || currentArea === 'town' || _isZoneArea(currentArea);
        const rainy = calendar.isRaining;
        const night = isNightTime();
        audioTrace('bgs resolve area=' + currentArea + ' exterior=' + exterior + ' rainy=' + rainy + ' night=' + night + ' rainStrength=' + (calendar.rainStrength || 0), 'bgs-resolve-' + currentArea, 5000);
        setLoopingBgs('birds', bgs.birds, exterior && !night && !rainy ? (bgs.birdsVolume ?? 0.25) : 0);
        setLoopingBgs('nightbugs', bgs.nightbugs, exterior && night ? (bgs.nightbugsVolume ?? 0.23) : 0);
        const wind01 = exterior ? Math.max(0, Math.min(1, (calendar.rainStrength || 0) / 3)) : 0;
        setLoopingBgs('wind1', bgs.wind1, (bgs.wind1Volume ?? 0.20) * Math.max(0, wind01 - 0.35) / 0.65);
        setLoopingBgs('wind2', bgs.wind2, (bgs.wind2Volume ?? 0.18) * (exterior ? Math.max(0.15, wind01 * 0.75) : 0));
      }

      function resolveFurnitureSfx(def) {
        if (!def) return null;
        if (def.sfx) return def.sfx;
        const key = def.sfxKey;
        return key ? gameAudioConfig().furnitureSfx?.[key] : null;
      }

      function registerFurnitureSfxSource(area, x, z, sfx) {
        if (!sfx?.url) return null;
        const audio = makeGameAudio(sfx.url, { loop: true });
        audio.volume = 0;
        const source = { area, x, z, range: Number(sfx.rangeTiles) || 5, maxVolume: Number(sfx.volume) || 0.7, audio };
        _furnitureSfxSources.push(source);
        audioDebug('registered furniture sfx area=' + area + ' url=' + audio.src + ' pos=' + x.toFixed(2) + ',' + z.toFixed(2) + ' range=' + source.range, 'furn-register-' + area + '-' + x + '-' + z, 0);
        return source;
      }

      function unregisterFurnitureSfxSource(source) {
        if (!source) return;
        const i = _furnitureSfxSources.indexOf(source);
        if (i >= 0) _furnitureSfxSources.splice(i, 1);
        source.audio.pause();
        source.audio.currentTime = 0;
        _gameAudioElements.delete(source.audio);
        audioDebug('unregistered furniture sfx area=' + source.area + ' pos=' + source.x.toFixed(2) + ',' + source.z.toFixed(2), 'furn-unregister-' + source.area + '-' + source.x + '-' + source.z, 0);
      }

      function updateFurnitureSfxSources() {
        const audioCfg = gameAudioConfig();
        if (audioCfg.enabled === false) {
          for (const src of _furnitureSfxSources) {
            src.audio.volume = 0;
            if (!src.audio.paused) src.audio.pause();
          }
          return;
        }
        for (const src of _furnitureSfxSources) {
          const active = src.area === currentArea;
          const dx = player.x / TILE - src.x;
          const dz = player.y / TILE - src.z;
          const dist = Math.hypot(dx, dz);
          const v = active ? src.maxVolume * Math.max(0, 1 - dist / src.range) : 0;
          src.audio.volume = Math.max(0, Math.min(1, v));
          if (v > 0.01 && src.audio.paused) {
            audioDebug('starting furniture sfx area=' + src.area + ' url=' + src.audio.src + ' volume=' + src.audio.volume.toFixed(2), 'furn-start-' + src.area + '-' + src.x + '-' + src.z, 0);
            src.audio.play().catch(err => audioDebug('furniture sfx play blocked/failed area=' + src.area + ': ' + (err?.name || err), 'furn-fail-' + src.area + '-' + src.x + '-' + src.z, 0));
          }
          if (v <= 0.01 && !src.audio.paused) {
            audioDebug('stopping furniture sfx area=' + src.area + ' pos=' + src.x.toFixed(2) + ',' + src.z.toFixed(2), 'furn-stop-' + src.area + '-' + src.x + '-' + src.z, 0);
            src.audio.pause();
          }
        }
      }

      function buildZoneScene(mapId) {
        if (_dirtyZoneScenes.has(mapId)) { _disposeZoneScene(mapId); _dirtyZoneScenes.delete(mapId); }
        if (_zoneScenes.has(mapId)) return _zoneScenes.get(mapId);
        const zdef = EXTERIOR_ZONES[mapId];
        const zoneData = _zoneLayouts.get(mapId);
        if (!zdef && !zoneData) return null;
        const ZCOLS = zoneData?.cols || zdef?.cols, ZROWS = zoneData?.rows || zdef?.rows;

        const fogColor = zdef?.fogColor ?? 0x33404a;
        const zScene = new THREE.Scene();
        zScene.background = new THREE.Color(fogColor);
        zScene.fog = new THREE.FogExp2(fogColor, 0.018); // match town/farm fog density
        zScene.add(new THREE.AmbientLight(0xfff0e0, 0.7));
        const sun = new THREE.DirectionalLight(0xffeedd, 1.1);
        sun.position.set(4, 8, 2);
        zScene.add(sun);

        const zGrid = Array.from({ length: ZROWS }, () =>
          Array.from({ length: ZCOLS }, () => ({
            type: TileType.GRASS, water: 0, crop: CropType.NONE,
            cropAge: 0, cropReady: false, stress: '', variation: 0,
          }))
        );
        // Plateau sub-maps are purely an authoring convenience in the Map Editor —
        // _loadTownFromWorkspace already recursively merged every tier of a plateau
        // stack into this one grid, so each tile here just carries its own absolute
        // elevTier (rendered below as continuous heightfield mesas, one per tier
        // transition, in the same visual style as the distant boundary terrain beyond
        // the playable area) and, for ramp tiles, its own slope-following rampElevation.
        for (const { c, r, type, elevTier, rampElevation, skipFloor, incline } of (zoneData?.tiles || [])) {
          if (!zGrid[r]?.[c]) continue;
          zGrid[r][c].type = type || TileType.GRASS;
          zGrid[r][c].elevTier = elevTier || 0;
          zGrid[r][c].skipFloor = !!skipFloor;
          zGrid[r][c].incline = !!incline;
          if (type === TileType.RAMP) zGrid[r][c].rampElevation = rampElevation || 0;
        }
        // Ramp curtains: a non-ramp cell beside a ramp cell gets folded into the
        // ramp's slope as a 1-tile-wide skirt instead of sitting flat — this is
        // what stops players walking off the side of an elevated ramp, and gives
        // the ramp the same cliff-face treatment a plateau gets. Cells already
        // `incline` (an existing plateau wall) are left alone so the ramp blends
        // into that wall instead of doubling it up (see buildRampCurtainMeshes).
        // A neighbor whose own ground height already matches the ramp there is
        // NOT a cliff — it's the flush approach/exit tile at the ramp's low or
        // high end (rampElevation lerps to exactly that tier's height at t=0/1) —
        // so it must stay walkable, not get walled off.
        const RAMP_FLUSH_EPS = 0.5; // world-Y; absorbs wide-ramp t fuzz near an end without masking a real side drop
        for (let r = 0; r < ZROWS; r++) for (let c = 0; c < ZCOLS; c++) {
          if (zGrid[r][c].type !== TileType.RAMP) continue;
          const rampY = NORMAL_TOP + (zGrid[r][c].rampElevation || 0) * PLATEAU_UNIT;
          for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nt = zGrid[r + dr]?.[c + dc];
            if (!nt || nt.type === TileType.RAMP || nt.incline) continue;
            const groundY = NORMAL_TOP + (nt.elevTier || 0) * PLATEAU_UNIT;
            if (Math.abs(rampY - groundY) < RAMP_FLUSH_EPS) continue;
            nt.incline = true; nt.skipFloor = true; nt.rampCurtain = true;
          }
        }
        const plateauMesas = zoneData?.mesas || [];
        console.log(`%c[zone:${mapId}] ${plateauMesas.length} plateau tier transition(s)`, 'color:#22c55e;font-weight:bold');

        // Ground: same per-vertex seam-safe heightfield pipeline as the town/farm
        // (makeFloorGeo / buildTerrainTileGeo / buildPathNetworkGeo), merged into one
        // mesh per material. Rock tiles get the farm's real stone-mound geometry
        // (buildRockTileGeo) instead of town's flatten-to-grass treatment, since here
        // rock tiles are actual cliff terrain, not building footprint markers.
        const _floorBuckets = new Map();
        const _addToBucket = (matKey, geo, x, y, z) => {
          if (!geo) return;
          let arr = _floorBuckets.get(matKey);
          if (!arr) { arr = []; _floorBuckets.set(matKey, arr); }
          arr.push({ geo, x, y, z });
        };

        const pathNet = buildPathNetworkGeo(zGrid, ZCOLS, ZROWS);
        if (pathNet) {
          _addToBucket(TileType.PATH,  pathNet.pathGeo,  0, NORMAL_TOP, 0);
          _addToBucket(TileType.GRASS, pathNet.grassGeo, 0, NORMAL_TOP, 0);
        }

        for (let r = 0; r < ZROWS; r++) for (let c = 0; c < ZCOLS; c++) {
          const tile = zGrid[r][c];
          const cx = c + 0.5, cz = r + 0.5;
          const tierY = (tile.elevTier || 0) * PLATEAU_UNIT;

          if (tile.skipFloor) continue; // covered by a plateau tier's mesa mesh below
          if (tile.type === TileType.RAMP) continue; // covered by the ramp slope mesh below

          if (tile.type === TileType.ROCK) {
            _addToBucket(TileType.GRASS, makeFloorGeo(c, r), cx, tileYCenter(TileType.GRASS) + tierY, cz);
            const { stoneGeo, grassGeo } = buildRockTileGeo(c, r);
            _addToBucket(TileType.ROCK,  stoneGeo, cx, NORMAL_TOP + tierY, cz);
            _addToBucket(TileType.GRASS, grassGeo, cx, NORMAL_TOP + tierY, cz);
            continue;
          }
          if (tile.type === TileType.TRENCH || tile.type === TileType.RAISED ||
              tile.type === TileType.RIVER || tile.type === TileType.STREAM || tile.type === TileType.WATERFALL) {
            const { dirtGeo, grassGeo } = buildTerrainTileGeo(c, r, tile.type, zGrid);
            const bedMatKey = (tile.type === TileType.RIVER || tile.type === TileType.STREAM || tile.type === TileType.WATERFALL) ? tile.type : TileType.TRENCH;
            _addToBucket(bedMatKey, dirtGeo, cx, NORMAL_TOP + tierY, cz);
            _addToBucket(TileType.GRASS, grassGeo, cx, NORMAL_TOP + tierY, cz);
            continue;
          }
          if (tile.type === TileType.PATH ||
              (pathNet && pathNet.inBounds(c, r) && !pathNet.isExcludedTile(c, r) && tile.type === TileType.GRASS)) {
            continue; // covered by the path network mesh above
          }
          if (tile.type === TileType.SHRUB) {
            _addToBucket(TileType.GRASS, makeFloorGeo(c, r), cx, tileYCenter(TileType.GRASS) + tierY, cz);
            if (window.FoliageGenerator) {
              const vegGroup = window.FoliageGenerator.buildShrubMesh(c, r);
              vegGroup.scale.set(2, 2, 2);
              vegGroup.position.set(cx, tileSurfaceY(TileType.GRASS) + tierY, cz);
              zScene.add(vegGroup);
              _markOutline(vegGroup);
            }
            continue;
          }
          const matKey = tileMats[tile.type] ? tile.type : TileType.GRASS;
          _addToBucket(matKey, makeFloorGeo(c, r), cx, tileYCenter(tile.type) + tierY, cz);
        }

        for (const [matKey, entries] of _floorBuckets) {
          const merged = _mergeTileGeos(entries);
          const mesh = new THREE.Mesh(merged, tileMats[matKey] || tileMats.grass);
          mesh.receiveShadow = true;
          zScene.add(mesh);
          _markTerrainEdgeId(mesh, _terrainCategoryFor(matKey));
        }

        // Each tier transition in the merged plateau stack renders as one continuous
        // heightfield mesa — same seam-noise/blend/steep-face-skin technique as the
        // distant boundary terrain beyond the playable area (buildZoneBorderTerrain)
        // — instead of a hard box: flat raised top across (almost) the whole tier's
        // footprint, smoothly blending down to the tier below across the outer
        // 1-tile margin (exactly how much smaller each plateau sub-map is than its
        // parent, so that margin is the cliff-face band).
        plateauMesas.forEach((mesa, i) => {
          const elevOffset = (mesa.toTier - mesa.fromTier) * PLATEAU_UNIT;
          if (elevOffset <= 0) return;
          buildPlateauMesa(zScene, mapId, `tier${i}`, mesa, elevOffset, mesa.fromTier * PLATEAU_UNIT, zGrid);
        });

        buildZoneRampMeshes(zScene, zGrid, ZCOLS, ZROWS, mapId);
        buildRampCurtainMeshes(zScene, zGrid, ZCOLS, ZROWS, mapId);
        buildRockFormationMeshes(zScene, zGrid, ZCOLS, ZROWS, mapId);
        _zoneWaterMeshes.set(mapId, [
          ...buildWaterfallCurtainMeshes(zScene, zGrid, ZCOLS, ZROWS, mapId),
          ...buildZoneRiverWaterMeshes(zScene, zGrid, ZCOLS, ZROWS, mapId),
        ]);

        _buildZoneGrassBillboards(zScene, zGrid, ZCOLS, ZROWS);
        buildZoneBorderTerrain(zScene, ZCOLS, ZROWS, mapId, 0, zGrid);

        const toTownExit = zoneData?.toTownExit;
        const backToTown = (toTownExit || zdef) ? [{
          id: mapId + '_exit', label: toTownExit?.label || 'Back to Town',
          col: toTownExit?.col ?? zdef.exitCol, row: toTownExit?.row ?? zdef.exitRow,
          target: 'town', targetCol: zdef?.townReturnCol, targetRow: zdef?.townReturnRow,
        }] : [];
        const transitions = [...backToTown, ...(zoneData?.transitions || [])];

        // Gold ring markers for zone transitions, matching town's
        const ringGeo = new THREE.RingGeometry(0.22, 0.36, 24);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
        for (const t of transitions) {
          const tile = zGrid[t.row]?.[t.col];
          const ring = new THREE.Mesh(ringGeo, ringMat);
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(t.col + 0.5, tileSurfaceYInArea(tile, mapId) + 0.02, t.row + 0.5);
          zScene.add(ring);
        }

        // Meshes tall enough to get between the fixed follow camera and the
        // player (plateau mesas, cliff-face rock skins — see their own
        // `.userData.cameraObstacle` tags) — collected once here rather than
        // walking the whole scene graph every frame in updateCameraPosition.
        const occlusionMeshes = [];
        zScene.traverse(o => { if (o.userData?.cameraObstacle) occlusionMeshes.push(o); });

        const info = { scene: zScene, grid: zGrid, cols: ZCOLS, rows: ZROWS, transitions, occlusionMeshes };
        _zoneScenes.set(mapId, info);
        _spawnZoneBuildings(mapId);
        _spawnZoneDecorFurniture(mapId);
        return info;
      }

      // One plateau group's footprint as a continuous heightfield mesa: flat raised
      // top across the interior, blending smoothly down to ground level over the
      // outer MARGIN_TILES band — the same seam-hash + blend + steep-face-stone-skin
      // technique buildZoneBorderTerrain uses for the distant boundary terrain beyond
      // the playable area, so an in-bounds plateau reads visually like those same
      // mesas instead of a flat-sided box. The margin band's width matches exactly
      // how much smaller each plateau's submap is than its parent (see
      // getOrCreateSubmap/resizeMapAndSubmaps in the Map Editor), since that band is
      // reserved for this cliff-face blend.
      function buildPlateauMesa(zScene, mapId, groupId, bb, elevOffset, zoneBaseElev = 0, zGrid = null) {
        const MARGIN_TILES = 1;
        const BASE = NORMAL_TOP + zoneBaseElev;
        const W = bb.maxC - bb.minC + 1, D = bb.maxR - bb.minR + 1;
        const GW = W * 2 + 1, GH = D * 2 + 1; // vertices, 0.5-tile spacing, matching makeFloorGeo

        const hashDisp = (kx, kz) => {
          let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
          h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
          return (h / 4294967296 - 0.5) * 0.026;
        };

        // Multi-source BFS directly on the VERTEX grid (0.5-tile spacing, same
        // grid as the position buffer below) so every vertex's blend reflects its
        // own true distance to the nearest "outside" point — the bbox's literal
        // edge, or an internal gap in an irregular/concave mask. A vertex is an
        // "outside" seed if it touches the literal grid perimeter, or if any tile
        // it borders is outside the painted footprint mask. Each BFS hop is 0.5
        // tile, so hops*0.5 is exactly the tile-distance the old formula used.
        // (Doing this per-tile-then-min-over-adjacent-tiles, as before, collapses
        // the whole outer ring tile to blend 0 and renders mask cells next to an
        // internal gap as fully raised even though mergeZoneTiles' onRing logic
        // treats them as low ring tiles — both produced the grass-overhang bug.)
        const mask = bb.maskWorldKeys || null;
        // A neighbor is also "inside" (no blend needed there) if a different,
        // touching mesa has already raised it to at least this tier — without
        // this, two side-by-side mesas at the same height each independently
        // trench their own margin band right at the shared border instead of
        // merging into one continuous top ("blending curtains together").
        // Ring cells of another, still-sloping mesa don't count: only an
        // already-flat raised top at >= this tier reads as a seamless match.
        const inMask = (c, r) => {
          if (!mask) return true;
          if (mask.has(`${c},${r}`)) return true;
          const t = zGrid?.[r]?.[c];
          return !!(t && !t.incline && (t.elevTier || 0) >= bb.toTier);
        };
        // Which tile(s) a vertex index borders along one axis — even gi sit on a
        // tile boundary (shared by the tile each side), odd gi sit at a single
        // tile's center. Deliberately NOT clamped to [0,N) — a perimeter vertex
        // (gi=0 or gi=GW-1) needs to see one tile step beyond this mesa's own
        // bbox too, so inMask can detect an adjacent mesa sitting right outside it.
        const axisTiles = (gi, N) => {
          const lo = Math.floor((gi - 1) / 2), hi = Math.floor(gi / 2), out = [lo];
          if (hi !== lo) out.push(hi);
          return out;
        };
        const vIdx = (gi, gj) => gj * GW + gi;
        const CAP = MARGIN_TILES * 2; // hops (0.5 tile each) — cap matches old margin in tiles
        const vertHops = new Int32Array(GW * GH).fill(CAP);
        // A higher tier's footprint sometimes lands right at the edge of a LOWER
        // tier's own ring band instead of fully inset onto its flat top (a tight
        // or irregularly-shaped lower mesa can leave less than one full margin
        // tile of flat interior at some rows/columns). Anchoring every seed
        // vertex to this mesa's own flat `BASE` then makes the upper curtain
        // float a flat ledge above the lower curtain's real (still-sloping,
        // lower) surface — two independently-blended heightfields disagreeing
        // right where they overlap. Anchor each seed to the ACTUAL elevation
        // already staked for whatever tile triggered it instead, so the upper
        // curtain starts from the lower curtain's real height there and the two
        // read as one continuous slope.
        const TOP = BASE + elevOffset;
        const seedHeightAt = (c, r) => {
          const t = zGrid?.[r]?.[c];
          return (t && typeof t.elevTier === 'number') ? NORMAL_TOP + t.elevTier * PLATEAU_UNIT : BASE;
        };
        const vertSeedY = new Float32Array(GW * GH).fill(BASE);
        const queue = [];
        for (let gj = 0; gj < GH; gj++) {
          const trs = axisTiles(gj, D);
          for (let gi = 0; gi < GW; gi++) {
            const tcs = axisTiles(gi, W);
            // A real outer edge (no neighboring mesa raised to match) naturally
            // seeds here too: inMask(c,r) for a world tile beyond the live grid
            // (zGrid[r]?.[c] undefined) falls through to false.
            let seedY = Infinity;
            for (const tc of tcs) for (const tr of trs) {
              const c = bb.minC + tc, r = bb.minR + tr;
              if (!inMask(c, r)) seedY = Math.min(seedY, seedHeightAt(c, r));
            }
            if (seedY !== Infinity) {
              const k = vIdx(gi, gj);
              vertHops[k] = 0; vertSeedY[k] = seedY; queue.push([gi, gj]);
            }
          }
        }
        for (let qi = 0; qi < queue.length; qi++) {
          const [gi, gj] = queue[qi], k0 = vIdx(gi, gj), d0 = vertHops[k0];
          if (d0 >= CAP) continue;
          for (const [dgi, dgj] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const ngi = gi + dgi, ngj = gj + dgj;
            if (ngi < 0 || ngi >= GW || ngj < 0 || ngj >= GH) continue;
            const nk = vIdx(ngi, ngj);
            if (d0 + 1 < vertHops[nk]) { vertHops[nk] = d0 + 1; vertSeedY[nk] = vertSeedY[k0]; queue.push([ngi, ngj]); }
          }
        }

        const Y = new Float32Array(GW * GH);
        for (let gj = 0; gj < GH; gj++) {
          for (let gi = 0; gi < GW; gi++) {
            const k = gj*GW+gi;
            const blend = Math.min(1, (vertHops[k] * 0.5) / MARGIN_TILES);
            const kx = bb.minC * 2 + gi, kz = bb.minR * 2 + gj; // absolute seam-hash key, matches adjacent makeFloorGeo tiles
            const seedY = vertSeedY[k];
            Y[k] = seedY + blend * (TOP - seedY) + hashDisp(kx, kz);
          }
        }

        // A ramp painted through this mesa's footprint (e.g. spooling around the
        // mesa's perimeter while climbing) doesn't follow this mesa's generic
        // 1-tile linear blend — it has its own, usually much slower, climb rate —
        // so the two heightfields disagree and visibly fight/clip where they
        // overlap. Wherever a ramp tile sits inside this bbox, snap that tile's
        // 3x3 vertex block onto the ramp's own corner heights (same averaging
        // buildZoneRampMeshes/buildRampCurtainMeshes use) instead of the BFS
        // blend, so the mesa surface there literally follows the ramp instead of
        // independently re-deriving a conflicting slope.
        const rampCornerY = (ci, cj) => {
          let sum = 0, n = 0;
          for (const [dc, dr] of [[0,0],[-1,0],[0,-1],[-1,-1]]) {
            const t = zGrid?.[cj + dr]?.[ci + dc];
            if (t && t.type === TileType.RAMP) { sum += NORMAL_TOP + (t.rampElevation || 0) * PLATEAU_UNIT; n++; }
          }
          return n ? sum / n : null;
        };
        const isRampTile = (tc, tr) => zGrid?.[bb.minR + tr]?.[bb.minC + tc]?.type === TileType.RAMP;
        for (let tr = 0; tr < D; tr++) {
          for (let tc = 0; tc < W; tc++) {
            if (!isRampTile(tc, tr)) continue;
            const wc = bb.minC + tc, wr = bb.minR + tr;
            const y00 = rampCornerY(wc, wr), y10 = rampCornerY(wc + 1, wr);
            const y01 = rampCornerY(wc, wr + 1), y11 = rampCornerY(wc + 1, wr + 1);
            for (let dj = 0; dj <= 2; dj++) {
              const fr = dj * 0.5;
              for (let di = 0; di <= 2; di++) {
                const fc = di * 0.5;
                const y = y00*(1-fc)*(1-fr) + y10*fc*(1-fr) + y01*(1-fc)*fr + y11*fc*fr;
                Y[(2*tr+dj)*GW + (2*tc+di)] = y;
              }
            }
          }
        }

        const pos = new Float32Array(GW * GH * 3);
        for (let gj = 0; gj < GH; gj++)
          for (let gi = 0; gi < GW; gi++) {
            const k = gj*GW+gi;
            pos[k*3]   = bb.minC + gi * 0.5;
            pos[k*3+1] = Y[k];
            pos[k*3+2] = bb.minR + gj * 0.5;
          }

        // Quads fully inside a ramp tile are left as holes — buildZoneRampMeshes
        // already renders that tile's own surface; doubling it here (even at a
        // matching height) just invites z-fighting.
        const quadIsRamp = (gi, gj) => isRampTile(Math.floor(gi / 2), Math.floor(gj / 2));
        // The bbox is just this mesa's bounding rectangle, not its painted shape —
        // an irregular/concave brush stroke leaves bbox cells that were never
        // painted at all. Those still get a flat BFS-blended Y above (so the BFS
        // distance field stays correct for the cells that ARE painted near them),
        // but they must NOT turn into a rendered quad, or the whole bbox reads as
        // a solid rectangular sheet regardless of the actual footprint. Gate on
        // the literal own-mask (bb.maskWorldKeys), not the broader inMask() —
        // inMask() also accepts a tile a DIFFERENT mesa already raised to match,
        // which must still skip rendering here since that tile belongs to the
        // other mesa, not this one.
        const quadInOwnMask = (gi, gj) => !mask || mask.has(`${bb.minC + Math.floor(gi/2)},${bb.minR + Math.floor(gj/2)}`);
        // A river/stream/waterfall/trench/raised cell carved INTO this mesa's own
        // footprint still gets a mask-passing, BFS-blended Y above (so neighboring
        // carved-tile geometry keeps blending against a sane height), but the flat
        // mesa lid/skin must not also render a quad on top of it — buildTerrainTileGeo
        // builds that cell's own carved-bed mesh, and without this check the mesa's
        // solid lid simply painted over it, hiding the channel under flat ground.
        const quadIsCarved = (gi, gj) => CARVED_TILE_TYPES.has(zGrid?.[bb.minR + Math.floor(gj/2)]?.[bb.minC + Math.floor(gi/2)]?.type);
        const idx = [];
        for (let gj = 0; gj < GH - 1; gj++) {
          for (let gi = 0; gi < GW - 1; gi++) {
            if (quadIsRamp(gi, gj) || quadIsCarved(gi, gj) || !quadInOwnMask(gi, gj)) continue;
            const v00 = gj*GW+gi, v10 = gj*GW+gi+1, v01 = (gj+1)*GW+gi, v11 = (gj+1)*GW+gi+1;
            idx.push(v00, v01, v11, v00, v11, v10);
          }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setIndex(new THREE.BufferAttribute(idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, tileMats.grass);
        mesh.receiveShadow = true;
        zScene.add(mesh);
        // A plateau's own lid+skin is the primary way the fixed follow camera
        // (see updateCameraPosition) can end up with something tall between
        // itself and the player — flagged so buildZoneScene can collect it
        // for the occlusion raycast.
        mesh.userData.cameraObstacle = true;

        // Steep plateau rock is now emitted by buildRockFormationMeshes, which
        // unions plateau cliffs with ramp side rock before rendering.

        console.log(`%c[zone:${mapId}] plateau mesa built for group ${groupId}: ${W}x${D} tiles, top=${(BASE+elevOffset).toFixed(2)}, margin=${MARGIN_TILES} tile(s)`, 'color:#22c55e;font-weight:bold');
      }

      // Smooth ramp slope mesh: one quad per authored RAMP tile, with each tile's 4
      // corner heights taken from the absolute world-Y (rampElevation * PLATEAU_UNIT)
      // of whichever ramp tiles touch that corner, averaged where more than one
      // ramp tile shares a corner — this follows the ramp's own monotonic gradient
      // instead of blending toward the zone's flat base height like buildPlateauMesa
      // does, since a ramp's whole point is to NOT be flat.
      function buildZoneRampMeshes(zScene, zGrid, zcols, zrows, mapId) {
        const rampCells = [];
        for (let r = 0; r < zrows; r++)
          for (let c = 0; c < zcols; c++)
            if (zGrid[r]?.[c]?.type === TileType.RAMP) rampCells.push([c, r]);
        if (!rampCells.length) return;

        const cornerY = (ci, cj) => {
          let sum = 0, n = 0;
          for (const [dc, dr] of [[0,0],[-1,0],[0,-1],[-1,-1]]) {
            const t = zGrid[cj + dr]?.[ci + dc];
            if (t && t.type === TileType.RAMP) { sum += NORMAL_TOP + (t.rampElevation || 0) * PLATEAU_UNIT; n++; }
          }
          return n ? sum / n : null;
        };

        const pos = [], idx = [];
        let vi = 0;
        for (const [c, r] of rampCells) {
          const fallback = NORMAL_TOP + (zGrid[r][c].rampElevation || 0) * PLATEAU_UNIT;
          const y00 = cornerY(c, r)     ?? fallback;
          const y10 = cornerY(c+1, r)   ?? fallback;
          const y01 = cornerY(c, r+1)   ?? fallback;
          const y11 = cornerY(c+1, r+1) ?? fallback;
          pos.push(c,y00,r,  c+1,y10,r,  c,y01,r+1,  c+1,y11,r+1);
          idx.push(vi,vi+2,vi+3, vi,vi+3,vi+1); vi += 4;
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setIndex(new THREE.BufferAttribute(idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, tileMats.path || tileMats.grass);
        mesh.receiveShadow = true;
        zScene.add(mesh);
        _markTerrainEdgeId(mesh, _terrainCategoryFor(TileType.PATH));

        console.log(`%c[zone:${mapId}] ramp mesh built: ${rampCells.length} tile(s)`, 'color:#22c55e;font-weight:bold');
      }

      // Ramp side curtains: a 1-tile sloped skirt on every cell flagged `rampCurtain`
      // (see buildZoneScene) — each corner takes the average height of whichever
      // adjacent RAMP cells touch it (same averaging buildZoneRampMeshes uses for
      // the ramp surface itself), falling back to the curtain cell's own natural
      // ground height at corners that don't touch a ramp. That tapers the skirt
      // from the ramp's edge down to ground over one tile — the same margin width
      // buildPlateauMesa uses for its cliff face — and picks up the same steep-face
      // stone skin so a ramp's sides read as a cut bank rather than floating grass.
      function buildRampCurtainMeshes(zScene, zGrid, zcols, zrows, mapId) {
        const cells = [];
        for (let r = 0; r < zrows; r++)
          for (let c = 0; c < zcols; c++)
            if (zGrid[r]?.[c]?.rampCurtain) cells.push([c, r]);
        if (!cells.length) return;

        const cornerY = (ci, cj, fallback) => {
          let sum = 0, n = 0;
          for (const [dc, dr] of [[0,0],[-1,0],[0,-1],[-1,-1]]) {
            const t = zGrid[cj + dr]?.[ci + dc];
            if (t && t.type === TileType.RAMP) { sum += NORMAL_TOP + (t.rampElevation || 0) * PLATEAU_UNIT; n++; }
          }
          return n ? sum / n : fallback;
        };

        const pos = [], idx = [];
        let vi = 0;
        for (const [c, r] of cells) {
          const ground = NORMAL_TOP + (zGrid[r][c].elevTier || 0) * PLATEAU_UNIT;
          const y00 = cornerY(c, r, ground);
          const y10 = cornerY(c + 1, r, ground);
          const y01 = cornerY(c, r + 1, ground);
          const y11 = cornerY(c + 1, r + 1, ground);
          pos.push(c, y00, r,  c + 1, y10, r,  c, y01, r + 1,  c + 1, y11, r + 1);
          idx.push(vi, vi + 2, vi + 3, vi, vi + 3, vi + 1); vi += 4;
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setIndex(new THREE.BufferAttribute(idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, tileMats.grass);
        mesh.receiveShadow = true;
        zScene.add(mesh);
        _markTerrainEdgeId(mesh, _terrainCategoryFor(TileType.GRASS));

        // Steep ramp-curtain skin is now emitted by buildRockFormationMeshes,
        // after unioning ramp side spans with neighboring plateau cliff spans.

        console.log(`%c[zone:${mapId}] ramp curtain skirt built: ${cells.length} tile(s)`, 'color:#22c55e;font-weight:bold');
      }


      // Unified solved non-walkable rock layer. This mirrors
      // docs/js/terrain-preview.js buildRockFormationGeometry: semantic plateau
      // cliff spans, ramp side spans, and ramp/plateau seam spans are unioned by
      // tile edge before rendering, so overlapping authored features become one
      // continuous rocky formation while walkable tops/ramp floors stay separate.
      function buildRockFormationMeshes(zScene, zGrid, zcols, zrows, mapId) {
        const rampCornerYFor = (ci, cj, fallback = null) => {
          let sum = 0, n = 0;
          for (const [dc, dr] of [[0,0],[-1,0],[0,-1],[-1,-1]]) {
            const t = zGrid?.[cj + dr]?.[ci + dc];
            if (t && t.type === TileType.RAMP) { sum += NORMAL_TOP + (t.rampElevation || 0) * PLATEAU_UNIT; n++; }
          }
          return n ? sum / n : fallback;
        };
        const cellCornerHeights = (c, r) => {
          const t = zGrid?.[r]?.[c];
          if (!t) return [NORMAL_TOP, NORMAL_TOP, NORMAL_TOP, NORMAL_TOP];
          if (t.type === TileType.RAMP) {
            const fallback = NORMAL_TOP + (t.rampElevation || 0) * PLATEAU_UNIT;
            return [rampCornerYFor(c, r, fallback), rampCornerYFor(c + 1, r, fallback), rampCornerYFor(c, r + 1, fallback), rampCornerYFor(c + 1, r + 1, fallback)];
          }
          const y = NORMAL_TOP + (t.elevTier || 0) * PLATEAU_UNIT;
          return [y, y, y, y];
        };
        const hash01 = (x, z, salt) => {
          let h = (2166136261 ^ Math.imul(Math.round(x * 8) + salt, 374761393) ^ Math.imul(Math.round(z * 8) - salt, 668265263)) >>> 0;
          h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
          return h / 4294967296;
        };
        const spans = new Map();
        const add = (key, axis, x0, z0, x1, z1, top0, top1, bottom0, bottom1, kind) => {
          if (Math.max(top0, top1) - Math.min(bottom0, bottom1) <= 0.04) return;
          const prev = spans.get(key);
          if (!prev) spans.set(key, { key, axis, x0, z0, x1, z1, top0, top1, bottom0, bottom1, kinds: new Set([kind]) });
          else { prev.top0 = Math.max(prev.top0, top0); prev.top1 = Math.max(prev.top1, top1); prev.bottom0 = Math.min(prev.bottom0, bottom0); prev.bottom1 = Math.min(prev.bottom1, bottom1); prev.kinds.add(kind); }
        };
        const kindOf = (a, b) => (a?.type === TileType.RAMP || b?.type === TileType.RAMP) ? ((a?.incline || b?.incline) ? 'ramp_plateau_seam' : 'ramp_side') : ((a?.incline || b?.incline) ? 'plateau_cliff' : 'tier_seam');
        for (let r = 0; r < zrows; r++) for (let c = 0; c < zcols; c++) {
          const t = zGrid?.[r]?.[c]; if (!t) continue;
          const [, y10, y01, y11] = cellCornerHeights(c, r);
          for (const [dc, dr, side] of [[1,0,'E'],[0,1,'S']]) {
            const nt = zGrid?.[r + dr]?.[c + dc];
            const [ny00, ny10, ny01] = cellCornerHeights(c + dc, r + dr);
            const a = side === 'E' ? [y10, y11] : [y01, y11];
            const b = side === 'E' ? [ny00, ny01] : [ny00, ny10];
            const top0 = Math.max(a[0], b[0]), top1 = Math.max(a[1], b[1]);
            const bottom0 = Math.min(a[0], b[0]), bottom1 = Math.min(a[1], b[1]);
            const step = Math.max(top0, top1) - Math.min(bottom0, bottom1);
            if (!(((t.type === TileType.RAMP || nt?.type === TileType.RAMP) && step > 0.04) || (step > 0.04 && (t.incline || nt?.incline || (t.elevTier || 0) !== (nt?.elevTier || 0))))) continue;
            if (side === 'E') add(`x:${c + 1}:${r}`, 'x', c + 1, r, c + 1, r + 1, top0, top1, bottom0, bottom1, kindOf(t, nt));
            else add(`z:${r + 1}:${c}`, 'z', c, r + 1, c + 1, r + 1, top0, top1, bottom0, bottom1, kindOf(t, nt));
          }
        }
        const pos = [], idx = []; let vi = 0;
        const pushV = (x, y, z, nx, nz, at, vt) => {
          const rib = (vt > 0.001 && vt < 0.999 && at > 0.001 && at < 0.999) ? (hash01(x, z, Math.round(y * 10)) - 0.5) * 0.16 : 0;
          const ledge = (vt > 0.15 && vt < 0.9 && Math.abs((vt * 5) % 1 - 0.5) < 0.14) ? 0.035 : 0;
          pos.push(x + nx * (rib + ledge), y, z + nz * (rib + ledge));
        };
        for (const s of spans.values()) {
          const nx = s.axis === 'x' ? (hash01(s.x0, s.z0, 7) > 0.5 ? 1 : -1) : 0;
          const nz = s.axis === 'z' ? (hash01(s.x0, s.z0, 11) > 0.5 ? 1 : -1) : 0;
          const segs = 2, base = vi;
          for (let j = 0; j <= segs; j++) for (let i = 0; i <= segs; i++) {
            const at = i / segs, vt = j / segs;
            const x = s.x0 + (s.x1 - s.x0) * at, z = s.z0 + (s.z1 - s.z0) * at;
            const top = s.top0 + (s.top1 - s.top0) * at, bot = s.bottom0 + (s.bottom1 - s.bottom0) * at;
            pushV(x, bot + (top - bot) * (1 - vt), z, nx, nz, at, vt);
          }
          for (let j = 0; j < segs; j++) for (let i = 0; i < segs; i++) {
            const a = base + j * (segs + 1) + i, b = a + 1, c0 = a + (segs + 1), d = c0 + 1;
            idx.push(a, c0, d, a, d, b);
          }
          vi += (segs + 1) * (segs + 1);
        }
        if (!idx.length) return;
        const mat = new THREE.MeshLambertMaterial({ color: 0x5f5a56, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setIndex(new THREE.BufferAttribute(idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        zScene.add(mesh);
        _markTerrainEdgeId(mesh, _terrainCategoryFor(TileType.ROCK));
        mesh.userData.cameraObstacle = true; // vertical cliff-face skin — see buildPlateauMesa's own tag
        console.log(`%c[zone:${mapId}] solved rock formation built: ${spans.size} edge span(s)`, 'color:#22c55e;font-weight:bold');
      }

      // Waterwall curtains: an animated vertical water sheet wherever a river
      // crosses a plateau edge (TileType.WATERFALL, stamped by the Map Editor's
      // mirrorRiverAcrossPlateau — see docs/js/terrain-preview.js's
      // buildWaterfallWallGeometry, which this mirrors). A waterfall cell's
      // merged-grid neighbor one step toward the footprint edge is always the
      // cliff-face ring — mergeZoneTiles always stakes that flat at `type:
      // 'grass'` on the lower tier (it's covered by the mesa mesh, not a real
      // floor tile) — so the elevTier step alone marks where the water needs to
      // climb, the same way buildRampCurtainMeshes uses an elevTier step to find
      // a ramp's sides. Returns the spawned mesh(es) for _zoneWaterMeshes.
      function buildWaterfallCurtainMeshes(zScene, zGrid, zcols, zrows, mapId) {
        const cells = [];
        for (let r = 0; r < zrows; r++)
          for (let c = 0; c < zcols; c++)
            if (zGrid[r]?.[c]?.type === TileType.WATERFALL) cells.push([c, r]);
        if (!cells.length) return [];

        const pos = [], uv = [], idx = [];
        let vi = 0;
        for (const [c, r] of cells) {
          const t = zGrid[r][c];
          const selfY = RIVER_TOP + (t.elevTier || 0) * PLATEAU_UNIT;
          for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nt = zGrid[r + dr]?.[c + dc];
            if (!nt || (nt.elevTier || 0) === (t.elevTier || 0)) continue;
            const neighborIsWater = nt.type === TileType.RIVER || nt.type === TileType.STREAM || nt.type === TileType.WATERFALL;
            const neighborY = (neighborIsWater ? RIVER_TOP : NORMAL_TOP) + (nt.elevTier || 0) * PLATEAU_UNIT;
            const top = Math.max(selfY, neighborY), bottom = Math.min(selfY, neighborY);
            if (top - bottom < 0.01) continue;
            let x0, z0, x1, z1;
            if (dc === 1)       { x0 = c+1; z0 = r;   x1 = c+1; z1 = r+1; }
            else if (dc === -1) { x0 = c;   z0 = r+1; x1 = c;   z1 = r;   }
            else if (dr === 1)  { x0 = c;   z0 = r+1; x1 = c+1; z1 = r+1; }
            else /* dr === -1 */{ x0 = c+1; z0 = r;   x1 = c;   z1 = r;   }
            pos.push(x0, top, z0,  x1, top, z1,  x0, bottom, z0,  x1, bottom, z1);
            uv.push(0,1, 1,1, 0,0, 1,0); // v=1 at top so uFlow=(0,1) scrolls downward
            idx.push(vi, vi+2, vi+3, vi, vi+3, vi+1); vi += 4;
          }
        }
        if (!pos.length) return [];

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(new THREE.BufferAttribute(idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
        geo.computeVertexNormals();

        const mat = new THREE.ShaderMaterial({
          uniforms: {
            uTime:  { value: 0 },
            uPhase: { value: 0 },
            uDepth: { value: 0.85 },
            uFlow:  { value: new THREE.Vector2(0, 1) }, // local UV-space "down" — always set, never still-mode
            uColor: { value: new THREE.Color(0x1f6f9c) },
          },
          vertexShader:   waterVertShader,
          fragmentShader: waterFragShader,
          transparent:    true,
          depthWrite:     false,
          side:           THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = false;
        zScene.add(mesh);
        _markTerrainEdgeId(mesh, 'water');

        console.log(`%c[zone:${mapId}] waterfall wall built: ${cells.length} cell(s)`, 'color:#22c55e;font-weight:bold');
        return [mesh];
      }

      // River/stream/waterfall water surface — an animated translucent plane
      // sitting above the sunken bed built in buildZoneScene's tile loop, so a
      // zone's waterways read as real water instead of just their bare bed
      // color. Mirrors _townRiverWaterMeshes (built in buildTownScene), but
      // each plane also carries its own tile's elevTier — a zone's water can
      // sit on any plateau tier, unlike town's single flat grid — and a
      // WATERFALL cell gets one too (the pool at the top/bottom of its
      // curtain from buildWaterfallCurtainMeshes above), not just plain
      // river/stream cells.
      function buildZoneRiverWaterMeshes(zScene, zGrid, zcols, zrows, mapId) {
        const isWaterTile = (cc, rr) => {
          const t = zGrid[rr]?.[cc]?.type;
          return t === TileType.RIVER || t === TileType.STREAM || t === TileType.WATERFALL;
        };
        const meshes = [];
        for (let r = 0; r < zrows; r++) for (let c = 0; c < zcols; c++) {
          const tile = zGrid[r][c];
          if (!isWaterTile(c, r)) continue;
          let fx = (isWaterTile(c + 1, r) ? 1 : 0) - (isWaterTile(c - 1, r) ? 1 : 0);
          let fz = (isWaterTile(c, r + 1) ? 1 : 0) - (isWaterTile(c, r - 1) ? 1 : 0);
          const flen = Math.hypot(fx, fz);
          if (flen > 0.001) { fx /= flen; fz /= flen; } else { fx = 0; fz = 0; }
          const deep = tile.type !== TileType.STREAM;
          const tierY = (tile.elevTier || 0) * PLATEAU_UNIT;
          const mat = new THREE.ShaderMaterial({
            uniforms: {
              uTime:  { value: 0 },
              uPhase: { value: (c * 2.7 + r * 4.1) % 6.28 },
              uDepth: { value: deep ? 0.8 : 0.45 },
              uFlow:  { value: new THREE.Vector2(fx, fz) },
              uColor: { value: new THREE.Color(deep ? 0x1f6f9c : 0x4fb8d9) },
            },
            vertexShader:   waterVertShader,
            fragmentShader: waterFragShader,
            transparent:    true,
            depthWrite:     false,
            side:           THREE.FrontSide,
          });
          // A dedicated PlaneGeometry per mesh (not the shared module-level
          // waterGeo used by farm/town) — _disposeZoneScene disposes every
          // mesh's geometry when a zone is torn down (e.g. on a Tothal
          // Shift), and that would take the shared geometry down with it,
          // breaking every other scene still using it. rotateX matches
          // waterGeo's own baked-in orientation so the plane lies flat.
          const geo = new THREE.PlaneGeometry(1.0, 1.0);
          geo.rotateX(-Math.PI / 2);
          const wm = new THREE.Mesh(geo, mat);
          wm.receiveShadow = false;
          wm.position.set(c + 0.5, NORMAL_TOP + tierY - (deep ? 0.10 : 0.05), r + 0.5);
          zScene.add(wm);
          _markTerrainEdgeId(wm, 'water');
          meshes.push(wm);
        }
        if (meshes.length) console.log(`%c[zone:${mapId}] river/stream/waterfall water surface built: ${meshes.length} tile(s)`, 'color:#22c55e;font-weight:bold');
        return meshes;
      }

      // Grass billboard tufts for a zone — mirrors _buildTownGrassBillboards but
      // parameterized so each zone gets its own InstancedMesh sized to its real grid.
      function _buildZoneGrassBillboards(zScene, zGrid, zcols, zrows, zoneBaseElev = 0) {
        if (!grassBillboardMat) return;
        let count = 0;
        for (let row = 0; row < zrows; row++)
          for (let col = 0; col < zcols; col++)
            if (zGrid[row]?.[col]?.type === TileType.GRASS) count++;
        if (count === 0) return;

        const mesh = new THREE.InstancedMesh(_grassBladeGeo, grassBillboardMat, count * 28);
        mesh.frustumCulled = false;
        mesh.visible = s_grass;
        const dummy = new THREE.Object3D();
        let idx = 0;
        for (let row = 0; row < zrows; row++) {
          for (let col = 0; col < zcols; col++) {
            if (zGrid[row]?.[col]?.type !== TileType.GRASS) continue;
            idx = _fillBillboardInstances(mesh, dummy, idx, col, row, 1.0, zoneBaseElev);
          }
        }
        mesh.count = idx;
        mesh.instanceMatrix.needsUpdate = true;
        zScene.add(mesh);
      }

      // Procedural cliff/border ring around a zone's playable area — same
      // rugged-plain + distant-cliffs passes as buildTownBorderTerrain, parameterized
      // by the zone's real size and a per-zone seed so each zone's border is distinct
      // but stable across visits.
      function buildZoneBorderTerrain(zScene, zcols, zrows, mapId, zoneBaseElev = 0, zGrid = null) {
        const BASE        = NORMAL_TOP + zoneBaseElev;
        const BORDER_W    = 18;
        const SEED        = (mapId.split('').reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0)) || 1;
        const BLEND_STEPS = 8;

        const BV  = BORDER_W * 2;
        const PVW = zcols * 2, PVH = zrows * 2;
        const GW  = PVW + 2*BV + 1;
        const GH  = PVH + 2*BV + 1;
        const CW  = GW - 1, CH = GH - 1;

        let _s = SEED >>> 0;
        const rng = () => {
          _s += 0x6D2B79F5;
          let t = Math.imul(_s ^ _s>>>15, _s|1);
          t ^= t + Math.imul(t ^ t>>>7, t|61);
          return ((t ^ t>>>14) >>> 0) / 4294967296;
        };

        const hashDisp = (vi, vj) => {
          let h = (2166136261 ^ (vi * 374761393) ^ (vj * 668265263)) >>> 0;
          h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
          return (h / 4294967296 - 0.5) * 0.026;
        };

        const vSteps = (gi, gj) => {
          const vi = gi - BV, vj = gj - BV;
          const dx = Math.max(0, -vi, vi - PVW);
          const dz = Math.max(0, -vj, vj - PVH);
          return Math.sqrt(dx*dx + dz*dz);
        };

        const isPlayable = (ci, cj) => ci>=BV && ci<BV+PVW && cj>=BV && cj<BV+PVH;

        // Seed height at each border vertex used to sit at one flat BASE
        // everywhere, so the border only ever read as a flat plain/skybox
        // wall with no relation to the actual zone it surrounds — obvious
        // wherever a zone's playable edge itself has cliffs or plateaus.
        // Weld the seam to the real playable-edge elevation instead (same
        // elevTier lookup buildPlateauMesa's seedHeightAt uses), fading back
        // to the flat BASE over SEAM_WELD_STEPS so only the near backdrop
        // reads as a continuation of the zone and the far horizon still
        // reads as generic distant terrain.
        const SEAM_WELD_STEPS = 16; // 8 tiles
        const nearestEdgeElevTier = (gi, gj) => {
          if (!zGrid) return null;
          const col = clamp(Math.floor((gi - BV) / 2), 0, zcols - 1);
          const row = clamp(Math.floor((gj - BV) / 2), 0, zrows - 1);
          const t = zGrid[row]?.[col];
          return (t && typeof t.elevTier === 'number') ? t.elevTier : null;
        };
        const Y = new Float32Array(GW * GH);
        for (let gj = 0; gj < GH; gj++)
          for (let gi = 0; gi < GW; gi++) {
            const jitter = hashDisp(gi-BV, gj-BV);
            const edgeTier = nearestEdgeElevTier(gi, gj);
            if (edgeTier === null) { Y[gj*GW+gi] = BASE + jitter; continue; }
            const edgeY = NORMAL_TOP + edgeTier * PLATEAU_UNIT;
            const weld = 1 - clamp(vSteps(gi, gj) / SEAM_WELD_STEPS, 0, 1);
            Y[gj*GW+gi] = BASE + jitter + weld * (edgeY - BASE);
          }

        const cv4 = (ci, cj) => [cj*GW+ci, cj*GW+ci+1, (cj+1)*GW+ci, (cj+1)*GW+ci+1];

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

        function raiseGroup(group, amount) {
          let maxY = -Infinity;
          const verts = new Set();
          for (const [ci,cj] of group)
            for (const vi of cv4(ci,cj)) { verts.add(vi); if(Y[vi]>maxY) maxY=Y[vi]; }
          const target = maxY + amount;
          for (const vi of verts) {
            const gi = vi%GW, gj = vi/GW|0;
            const st = vSteps(gi, gj);
            if (st === 0) continue;
            const blend  = Math.min(1, st / BLEND_STEPS);
            const raised = BASE + hashDisp(gi-BV, gj-BV) + blend*(target - BASE);
            if (raised > Y[vi]) Y[vi] = raised;
          }
        }

        function pickCell(outerBias) {
          const rim = BV >> 2;
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

        for (let p = 0; p < 55; p++) {
          const [ci,cj] = pickCell(0.12);
          raiseGroup(pickGroup(ci, cj, 4 + Math.floor(rng()*18)), 0.05 + rng()*0.32);
        }
        for (let p = 0; p < 32; p++) {
          const [ci,cj] = pickCell(0.88);
          raiseGroup(pickGroup(ci, cj, 10 + Math.floor(rng()*38)), 0.9 + rng()*3.2);
        }

        const RIM_V   = 20;
        const RIM_MIN = BASE + 3.0;
        for (let gj = 0; gj < GH; gj++) {
          for (let gi = 0; gi < GW; gi++) {
            if (gj >= RIM_V && gj <= GH-1-RIM_V &&
                gi >= RIM_V && gi <= GW-1-RIM_V) continue;
            const k = gj * GW + gi;
            if (Y[k] < RIM_MIN) Y[k] = RIM_MIN;
          }
        }

        const pos = new Float32Array(GW * GH * 3);
        for (let gj = 0; gj < GH; gj++)
          for (let gi = 0; gi < GW; gi++) {
            const k = gj*GW+gi;
            pos[k*3]   = (gi-BV)*0.5;
            pos[k*3+1] = Y[k];
            pos[k*3+2] = (gj-BV)*0.5;
          }

        const idx = [];
        for (let cj = 0; cj < CH; cj++) {
          for (let ci = 0; ci < CW; ci++) {
            if (isPlayable(ci, cj)) continue;
            const [v00,v10,v01,v11] = cv4(ci,cj);
            idx.push(v00, v01, v11, v00, v11, v10);
          }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setIndex(new THREE.BufferAttribute(idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, tileMats.grass);
        mesh.receiveShadow = true;
        zScene.add(mesh);

        // Stone cliff skin: same normal-based overlay rule as the farm/town border
        // terrain — faces steeper than ~41° from horizontal get a stone skin instead
        // of grass (cnx²+cnz² > 0.194 for a 0.5×0.5 cell, see buildBorderTerrain).
        const cliffMat = new THREE.MeshLambertMaterial({
          color: 0x6a6460, side: THREE.DoubleSide,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
        });

        function elevStoneSkin(gjMin, gjMax, giMin, giMax) {
          const skinPos = [], idxArr = [];
          let vi = 0;
          for (let gj = gjMin; gj < gjMax; gj++) {
            for (let gi = giMin; gi < giMax; gi++) {
              const y00=Y[gj*GW+gi],     y10=Y[gj*GW+gi+1];
              const y01=Y[(gj+1)*GW+gi], y11=Y[(gj+1)*GW+gi+1];
              const cnx = -0.5 * ((y10 + y11) - (y00 + y01));
              const cnz =  0.5 * ((y10 - y01) - (y11 - y00));
              if (cnx * cnx + cnz * cnz <= 0.194) continue;  // near-horizontal → grass
              const x0=(gi-BV)*0.5, x1=x0+0.5;
              const z0=(gj-BV)*0.5, z1=z0+0.5;
              skinPos.push(x0,y00,z0, x1,y10,z0, x0,y01,z1, x1,y11,z1);
              idxArr.push(vi,vi+2,vi+3, vi,vi+3,vi+1); vi+=4;
            }
          }
          if (!skinPos.length) return;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(skinPos, 3));
          g.setIndex(new THREE.BufferAttribute(idxArr.length > 65535 ? new Uint32Array(idxArr) : new Uint16Array(idxArr), 1));
          g.computeVertexNormals();
          zScene.add(new THREE.Mesh(g, cliffMat));
        }

        elevStoneSkin(0,           BV,          0,          GW - 1); // north strip
        elevStoneSkin(GH - 1 - BV, GH - 1,      0,          GW - 1); // south strip
        elevStoneSkin(BV,          GH - 1 - BV, 0,          BV);      // west strip
        elevStoneSkin(BV,          GH - 1 - BV, GW - 1 - BV, GW - 1); // east strip
      }

      function initWorldTravel(layout) {
        if (layout?.version === 3) {
          worldTransitions = (layout.transitions || []).filter(t =>
            t && Number.isFinite(t.col) && Number.isFinite(t.row) && (t.area || 'farm') !== 'town');
          worldNpcPaths = (layout.npcPaths || []).filter(p =>
            p && Array.isArray(p.nodes) && p.nodes.length > 0 && (p.area || 'farm') !== 'town');
          worldRoutes = normalizeRoutes(
            (layout.routes || []).filter(r => (r.area || 'farm') !== 'town'),
            worldNpcPaths);
          registerNpcStations(layout.npcStations, null);
          registerMapAudio(layout.mapAudio);
          rebuildRouteGraphs();
        }
        // Don't fire a spot the player happens to spawn on
        _transitionLatch = travelAreaKey();
        buildTransitionMarkers();
        spawnScheduledNpcs().catch(e => console.warn('spawnScheduledNpcs failed:', e));
      }

      function _travelAreaOf(area) {
        return _isBuildingArea(area) ? area : _isZoneArea(area) ? area : area === 'interior' ? 'interior' : area === 'town' ? 'town' : 'farm';
      }

      function travelAreaKey() {
        const area = _travelAreaOf(currentArea);
        return area + ':' + Math.floor(player.x / TILE) + ',' + Math.floor(player.y / TILE);
      }

      function buildTransitionMarkers() {
        const _ringGeo = new THREE.RingGeometry(0.22, 0.36, 24);
        const _ringMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
        for (const t of worldTransitions) {
          const interior = t.area === 'interior';
          const g = interior ? interiorGrid : grid;
          const tile = g[t.row]?.[t.col];
          if (!tile) continue;
          const ring = new THREE.Mesh(_ringGeo, _ringMat);
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(t.col + 0.5, tileSurfaceY(tile.type) + 0.02, t.row + 0.5);
          (interior ? interiorScene : scene).add(ring);
        }
      }

      function checkTransitionSpots() {
        const area = _travelAreaOf(currentArea);
        const pc = Math.floor(player.x / TILE), pr = Math.floor(player.y / TILE);
        const key = area + ':' + pc + ',' + pr;
        if (key === _transitionLatch) { _pendingSpotTransition = null; return; }
        _transitionLatch = null;
        let pool;
        if (_isBuildingArea(area)) pool = _buildingScenes.get(area)?.transitions || [];
        else if (_isZoneArea(area)) pool = _zoneScenes.get(area)?.transitions || [];
        else pool = area === 'town' ? worldTownTransitions : worldTransitions;
        const t = pool.find(x =>
          (_isBuildingArea(area) || _isZoneArea(area) || x.area === area) && x.col === pc && x.row === pr &&
          (x.target === 'building' ? !!x.targetMapId : x.target === 'zone' ? !!x.targetMapId : x.target === 'exit_building' ? true : (Number.isFinite(x.targetCol) && Number.isFinite(x.targetRow))));
        if (t !== _pendingSpotTransition) { _pendingSpotTransition = t || null; refreshActionBar(); }
        // Farm interior exit fires automatically (legacy behaviour)
        if (t && area === 'interior') startSceneTransition(() => performTravel(t));
      }

      function _returnToFarmMeshes() {
        if (currentArea === 'interior') {
          interiorScene.remove(playerMesh);
          interiorScene.remove(playerGroundShadow);
        } else if (currentArea === 'town' && townScene) {
          townScene.remove(playerMesh);
          townScene.remove(playerGroundShadow);
        } else if (_isBuildingArea(currentArea)) {
          const bs = _buildingScenes.get(currentArea);
          if (bs?.scene) { bs.scene.remove(playerMesh); bs.scene.remove(playerGroundShadow); }
          _currentBuildingMapId = null;
        }
        scene.add(playerMesh);
        scene.add(playerGroundShadow);
        scene.add(toolHolder);
        scene.add(reticleMesh);
        scene.add(reticleCircleMesh);
        scene.add(reticleRingMesh);
        scene.add(reticleWavyGroup);
        currentArea = 'farm';
        refreshActionBar();
      }

      function performTravel(t) {
        if (t.target === 'exit_building') {
          exitBuilding();
        } else if (t.target === 'building') {
          enterBuilding(t.targetMapId, t.targetCol, t.targetRow);
        } else if (t.target === 'interior') {
          if (currentArea !== 'interior') enterInterior();
          const c = clamp(t.targetCol, 0, INTERIOR_COLS - 1);
          const r = clamp(t.targetRow, 0, INTERIOR_ROWS - 1);
          player.x = (c + 0.5) * TILE;
          player.y = (r + 0.5) * TILE;
        } else if (t.target === 'town') {
          const tcols = _townZone?.cols || 60, trows = _townZone?.rows || 50;
          const c = clamp(t.targetCol, 0, tcols - 1);
          const r = clamp(t.targetRow, 0, trows - 1);
          enterTown(c, r);
        } else if (t.target === 'zone') {
          enterZone(t.targetMapId, t.targetCol, t.targetRow);
        } else { // 'farm'
          _returnToFarmMeshes();
          const c = clamp(t.targetCol, 0, COLS - 1);
          const r = clamp(t.targetRow, 0, ROWS - 1);
          player.x = (c + 0.5) * TILE;
          player.y = (r + 0.5) * TILE;
        }
        player.vx = 0;  player.vy = 0;
        _snapCameraTarget();
        _transitionLatch = travelAreaKey();
        if (t.target !== 'building' && t.target !== 'exit_building') logMapSwap('travel', currentArea, { target: t.target || 'farm' });
      }


      function pngAvatarGroundShadowConfig() {
        return window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.groundShadow || {};
      }

      function makeCharacterGroundShadow(name = 'character_ground_shadow') {
        const cfg = pngAvatarGroundShadowConfig();
        const geo = new THREE.CircleGeometry(1, 40);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(cfg.color || '#1b1712'),
          transparent: true,
          opacity: cfg.opacity ?? 0.28,
          depthWrite: false,
        });
        const shadow = new THREE.Mesh(geo, mat);
        shadow.name = name;
        shadow.renderOrder = -1;
        shadow.scale.set(cfg.radiusX ?? 0.34, 1, cfg.radiusZ ?? 0.22);
        return shadow;
      }

      function characterGroundShadowSurfaceOffset() {
        return pngAvatarGroundShadowConfig().surfaceOffsetY ?? 0.018;
      }

      // Ties a creature's shadow footprint to the same modelWidth used for
      // its own hit cone/collision radius (see creatureHitboxHalfSizePx)
      // instead of the player/NPC's fixed humanoid size, so e.g. a gar-wolf
      // alpha visibly casts a bigger shadow than a dabinggi-hound. Keeps the
      // configured player shadow's X:Z squash ratio rather than introducing
      // a separate tunable.
      function creatureGroundShadowRadii(def) {
        const cfg = pngAvatarGroundShadowConfig();
        const baseRadiusX = cfg.radiusX ?? 0.34;
        const baseRadiusZ = cfg.radiusZ ?? 0.22;
        const radiusX = (def.modelWidth || 2) * 0.3;
        return { radiusX, radiusZ: radiusX * (baseRadiusZ / baseRadiusX) };
      }

      // ── Schedule-driven NPCs: beeline first, shared routes as fallback ─
      const NPC_SPECIES_IDS = ['mao-ao', 'tletingan', 'kenkari', 'engh-sho', 'rakakoan'];

      function npcMovementConfig() { return window.SCRATCHBONES_CONFIG?.game?.movement?.npc || {}; }
      function npcDialogueStagingConfig() { return window.SCRATCHBONES_CONFIG?.game?.npcDialogue?.staging || {}; }
      function cameraConfig() { return window.SCRATCHBONES_CONFIG?.game?.camera || {}; }
      function cameraModesConfig() { return cameraConfig().modes || {}; }
      function cameraModeConfig(mode) {
        const modes = cameraModesConfig();
        return modes[mode] || modes[cameraConfig().defaultMode] || modes.default || {};
      }
      function npcDialogueCameraMode() { return cameraConfig().dialogueMode || 'npcDialogue'; }
      function dialogueZoomConfig() { return cameraModeConfig(npcDialogueCameraMode()).runtimeZoom || {}; }
      function dialogueZoomEnabled() { return dialogueZoomConfig().enabled !== false; }
      function dialogueZoomActive() { return dialogueOpen && activeCameraMode === npcDialogueCameraMode() && dialogueZoomEnabled(); }
      function clampDialogueZoomPercent(value) {
        const cfg = dialogueZoomConfig();
        return clamp(value, cfg.minPercent ?? 0, cfg.maxPercent ?? 100);
      }
      function dialogueZoomFactor() {
        const cfg = dialogueZoomConfig();
        const minPercent = cfg.minPercent ?? 0;
        const maxPercent = cfg.maxPercent ?? 100;
        const range = Math.max(0.001, maxPercent - minPercent);
        const normalized = clamp((dialogueCameraZoomPercent - minPercent) / range, 0, 1);
        return 1 + normalized * ((cfg.maxZoomFactor ?? 2.5) - 1);
      }
      function setDialogueCameraZoomPercent(value) {
        dialogueCameraZoomPercent = clampDialogueZoomPercent(value);
        updateDialogueZoomIndicator();
      }
      function updateDialogueZoomIndicator() {
        if (!dialogueZoomIndicator) return;
        dialogueZoomIndicator.textContent = `${Math.round(dialogueCameraZoomPercent)}%`;
        dialogueZoomIndicator.setAttribute('aria-hidden', dialogueZoomActive() ? 'false' : 'true');
        dialogueZoomIndicator.classList.toggle('open', dialogueZoomActive());
      }
      function resetDialogueCameraZoom() {
        setDialogueCameraZoomPercent(dialogueZoomConfig().initialPercent ?? 0);
      }
      function desktopControlsConfig() { return window.SCRATCHBONES_CONFIG?.game?.desktopControls || {}; }
      function npcDialogueButtonConfig() {
        return window.SCRATCHBONES_CONFIG?.game?.mobileControls?.npcDialogueButton || {};
      }
      function npcDialogueAction() { return npcDialogueButtonConfig().action || 'npc_dialogue'; }
      function generalStoreButtonConfig() {
        return window.SCRATCHBONES_CONFIG?.game?.mobileControls?.generalStoreButton || {};
      }
      function generalStoreAction() { return generalStoreButtonConfig().action || 'open_general_store'; }
      function normalizeStationLabel(label) {
        return String(label || '').trim().toLowerCase();
      }
      function isGeneralStoreNpcOnDuty(walker) {
        const cfg = generalStoreButtonConfig();
        const ids = Array.isArray(cfg.npcIds) ? cfg.npcIds : ['furunji_funji', 'foroji_funji'];
        const stationLabels = Array.isArray(cfg.stationLabels) ? cfg.stationLabels : [];
        const npcId = walker?.rec?.id || '';
        const target = walker?.currentScheduleTarget || null;
        const stationLabel = normalizeStationLabel(target?.label);
        const isAtStation = walker?.state === 'idle' && target && Number.isFinite(target.c) && Number.isFinite(target.r)
          && Math.hypot(walker.root.position.x - (target.c + 0.5), walker.root.position.z - (target.r + 0.5)) <= (npcMovementConfig().arrivalRadiusTiles ?? 0.18);
        return ids.includes(npcId) && isAtStation && stationLabels.some(label => stationLabel === normalizeStationLabel(label));
      }
      function generalStoreButton() {
        const cfg = generalStoreButtonConfig();
        const name = nearbyNpcWalker?.rec?.name;
        return {
          icon: cfg.icon || '🛒',
          label: name ? `${cfg.label || 'Shop'}: ${name}` : (cfg.label || 'Shop'),
          action: generalStoreAction(),
          style: cfg.style || 'primary',
          allowed: true,
        };
      }

      function npcDialogueStagingOffsets() {
        const offsets = npcDialogueStagingConfig().playerDiagonalOffsets;
        return Array.isArray(offsets) && offsets.length ? offsets : [{ x: -0.5, y: 1 }, { x: 0.5, y: 1 }];
      }

      function beginNpcDialogueStaging(walker) {
        const npcX = walker?.root?.position?.x;
        const npcZ = walker?.root?.position?.z;
        if (!Number.isFinite(npcX) || !Number.isFinite(npcZ)) { npcDialogueStaging = null; return; }
        const playerWorldX = player.x / TILE;
        const playerWorldZ = player.y / TILE;
        const candidates = npcDialogueStagingOffsets().map(offset => ({
          x: npcX + (Number(offset.x) || 0),
          z: npcZ + (Number(offset.y) || 0),
        }));
        candidates.sort((a, b) => Math.hypot(playerWorldX - a.x, playerWorldZ - a.z) - Math.hypot(playerWorldX - b.x, playerWorldZ - b.z));
        const target = candidates.find(pos => canPlayerOccupy(pos.x * TILE, pos.z * TILE)) || candidates[0];
        npcDialogueStaging = { walker, targetX: target.x, targetZ: target.z };
        player.vx = 0;
        player.vy = 0;
      }

      function faceNpcDialogueParticipants() {
        const walker = npcDialogueStaging?.walker || _dialogueWalker;
        if (!walker?.root) return;
        const cfg = npcDialogueStagingConfig();
        const playerWorldX = player.x / TILE;
        const playerWorldZ = player.y / TILE;
        const npcX = walker.root.position.x;
        const npcZ = walker.root.position.z;
        const playerTargetAngle = Math.atan2(npcZ - playerWorldZ, npcX - playerWorldX);
        facingAngle += angleDiff(playerTargetAngle, facingAngle) * (cfg.faceLerp ?? 0.28);
        player.angle = facingAngle;
        const npcTargetAngle = Math.atan2(playerWorldZ - npcZ, playerWorldX - npcX);
        const npcTargetRot = -npcTargetAngle + Math.PI / 2;
        walker.rot += angleDiff(npcTargetRot, walker.rot) * (cfg.npcFacePlayerLerp ?? 0.28);
        walker.root.rotation.y = walker.rot;
      }

      function updateNpcDialogueStaging(dt) {
        if (!npcDialogueStaging?.walker?.root) return;
        const cfg = npcDialogueStagingConfig();
        const speed = (cfg.moveSpeedTilesPerSecond ?? 4.25) * TILE;
        const arrival = (cfg.arrivalRadiusTiles ?? 0.08) * TILE;
        const targetX = npcDialogueStaging.targetX * TILE;
        const targetY = npcDialogueStaging.targetZ * TILE;
        const dx = targetX - player.x;
        const dy = targetY - player.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= arrival) {
          player.x = targetX;
          player.y = targetY;
          player.vx = 0;
          player.vy = 0;
          faceNpcDialogueParticipants();
          return;
        }
        const step = Math.min(dist, speed * dt);
        const desiredX = player.x + dx / dist * step;
        const desiredY = player.y + dy / dist * step;
        let moved = false;
        if (canPlayerOccupy(desiredX, player.y)) { player.x = desiredX; moved = true; }
        if (canPlayerOccupy(player.x, desiredY)) { player.y = desiredY; moved = true; }
        player.vx = moved ? dx / dist * speed : 0;
        player.vy = moved ? dy / dist * speed : 0;
        faceNpcDialogueParticipants();
      }

      function npcDialogueButton() {
        const cfg = npcDialogueButtonConfig();
        const name = nearbyNpcWalker?.rec?.name;
        return {
          icon: cfg.icon || '💬',
          label: name ? `${cfg.label || 'Talk'}: ${name}` : (cfg.label || 'Talk'),
          action: npcDialogueAction(),
          style: cfg.style || 'primary',
          allowed: true,
        };
      }

      function normalizeRoutes(routes, legacyPaths = []) {
        const out = (routes || []).filter(r => r && Array.isArray(r.nodes) && r.nodes.length > 0)
          .map(r => ({ id: r.id, label: r.label || 'Route', area: normalizeNpcArea(r.area || 'farm'), nodes: r.nodes.map(n => [n[0], n[1]]) }));
        if (!out.length) legacyPaths.forEach(p => out.push({ id: 'legacy_' + (p.id || p.label || out.length), label: p.label || 'Legacy route', area: normalizeNpcArea(p.area || 'farm'), nodes: p.nodes.map(n => [n[0], n[1]]) }));
        return out;
      }

      // Whether the straight segment between two route nodes stays on dry,
      // walkable ground (no river crossing) — sampled the same way as
      // canNpcBeeline so authored route edges respect the same rules.
      function isRouteSegmentDry(area, c1, r1, c2, r2) {
        const x1 = c1 + 0.5, z1 = r1 + 0.5, x2 = c2 + 0.5, z2 = r2 + 0.5;
        const dist = Math.hypot(x2 - x1, z2 - z1);
        const samples = Math.max(1, Math.ceil(dist / 0.5));
        for (let i = 0; i <= samples; i++) {
          const t = i / samples;
          const c = Math.floor(x1 + (x2 - x1) * t);
          const r = Math.floor(z1 + (z2 - z1) * t);
          if (!isNpcTileWalkable(area, c, r)) return false;
        }
        return true;
      }

      function buildRouteGraph(routes) {
        const nodes = new Map();
        const key = (area, c, r) => area + ':' + c + ',' + r;
        const ensure = (area, c, r) => {
          const k = key(area, c, r);
          if (!nodes.has(k)) nodes.set(k, { key: k, area, c, r, edges: new Set(), routeIds: new Set() });
          return nodes.get(k);
        };
        routes.forEach(route => {
          const area = route.area || 'farm';
          let prev = null;
          (route.nodes || []).forEach(([c, r]) => {
            const node = ensure(area, c, r);
            if (route.id) node.routeIds.add(route.id);
            // Skip edges that wade through a river — NPCs following this route
            // will detour via any other dry edge instead of crossing the water.
            if (prev && isRouteSegmentDry(area, prev.c, prev.r, c, r)) { prev.edges.add(node.key); node.edges.add(prev.key); }
            prev = node;
          });
        });
        return { nodes };
      }

      function rebuildRouteGraphs() {
        routeGraphsByArea.clear();
        const areas = new Set(['farm', 'interior', 'town']);
        [...worldRoutes, ...worldTownRoutes].forEach(r => areas.add(r.area || 'farm'));
        for (const area of areas) {
          const routes = [...worldRoutes, ...worldTownRoutes].filter(r => (r.area || 'farm') === area);
          routeGraphsByArea.set(area, buildRouteGraph(routes));
        }
      }

      function distanceToTarget(node, target) { return Math.hypot((node.c + 0.5) - (target.c + 0.5), (node.r + 0.5) - (target.r + 0.5)); }

      function findNearestRouteNode(area, x, z, target) {
        const graph = routeGraphsByArea.get(area);
        const routeId = target?.routeId || null;
        const maxDist = npcMovementConfig().routeSnapRadiusTiles ?? 8;
        let best = null, bestD = Infinity;
        graph?.nodes.forEach(node => {
          if (routeId && !node.routeIds.has(routeId)) return;
          const d = Math.hypot(node.c + 0.5 - x, node.r + 0.5 - z);
          if (d <= maxDist && (!target || distanceToTarget(node, target) < Math.hypot(x - (target.c + 0.5), z - (target.r + 0.5))) && d < bestD) { best = node; bestD = d; }
        });
        return best;
      }

      function findBestRouteDestinationNode(graph, target) {
        const routeId = target?.routeId || null;
        let best = null, bestD = Infinity;
        graph?.nodes.forEach(node => {
          if (routeId && !node.routeIds.has(routeId)) return;
          const d = distanceToTarget(node, target);
          if (d < bestD) { best = node; bestD = d; }
        });
        return best;
      }

      // Full shortest-path walk (via BFS) from `startNode` to whichever route
      // node sits nearest the target, instead of a greedy "pick whichever
      // neighbor is closer than here" step. The greedy version refuses any
      // edge that doesn't immediately shrink the distance to target, so at
      // junction nodes with no immediately-closer neighbor — door tiles are
      // exactly this, since routes typically bend right where they cross a
      // threshold — it gives up and the NPC freezes there indefinitely.
      function computeRoutePathToTarget(startNode, target) {
        const graph = routeGraphsByArea.get(startNode.area);
        if (!graph) return null;
        const dest = findBestRouteDestinationNode(graph, target);
        if (!dest || dest.key === startNode.key) return [];
        const routeId = target?.routeId || null;
        const prevByKey = new Map();
        const visited = new Set([startNode.key]);
        const queue = [startNode.key];
        for (let i = 0; i < queue.length; i++) {
          const curKey = queue[i];
          if (curKey === dest.key) break;
          const cur = graph.nodes.get(curKey);
          cur.edges.forEach(k => {
            if (visited.has(k)) return;
            const n = graph.nodes.get(k);
            if (routeId && n && !n.routeIds.has(routeId)) return;
            visited.add(k);
            prevByKey.set(k, curKey);
            queue.push(k);
          });
        }
        if (!visited.has(dest.key)) return null;
        const path = [];
        let curKey = dest.key;
        while (curKey !== startNode.key) {
          path.unshift(graph.nodes.get(curKey));
          curKey = prevByKey.get(curKey);
          if (curKey === undefined) return null;
        }
        return path;
      }

      function isNpcTileWalkable(area, c, r) {
        const g = area === 'interior' ? interiorGrid : area === 'town' ? townGrid : grid;
        const tile = g[r]?.[c];
        if (!tile || isSolid(tile.type) || tile.crop || tile.type === TileType.TRENCH || tile.type === TileType.RIVER || tile.type === TileType.STREAM) return false;
        if (area === 'farm' && (worldObjects.has(c + ',' + r) || isHouseFootprint(c, r))) return false;
        if (area !== 'town' && interiorFurnitureObjects.some(o => o.area === area && o.col === c && o.row === r)) return false;
        if (area === 'town' && isTownBuildingCollisionTile(c, r)) return false;
        if (_isZoneArea(area) && isTownBuildingCollisionTile(c, r, area)) return false;
        if (_isBuildingArea(area)) { const g = npcGridForArea(area); return !!g?.[r]?.[c] && !isSolid(g[r][c].type); }
        return true;
      }

      function canNpcBeeline(area, fromX, fromZ, targetC, targetR) {
        const tx = targetC + 0.5, tz = targetR + 0.5;
        const dist = Math.hypot(tx - fromX, tz - fromZ);
        const step = npcMovementConfig().beelineSampleStepTiles ?? 0.25;
        const samples = Math.max(1, Math.ceil(dist / step));
        for (let i = 0; i <= samples; i++) {
          const t = i / samples;
          const c = Math.floor(fromX + (tx - fromX) * t);
          const r = Math.floor(fromZ + (tz - fromZ) * t);
          if (!isNpcTileWalkable(area, c, r)) return false;
        }
        return true;
      }

      function parseNpcTimeMinutes(t) { const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
      function currentGameMinutes() { return Math.round(getHour() * 60); }
      function isNowWithinNpcRuleWindow(now, start, end) {
        if (start === null || end === null) return false;
        if (start <= end) return now >= start && now < end;
        return now >= start || now < end;
      }
      function normalizeNpcArea(area) {
        if (!area) return 'farm';
        if (area === 'interior') return 'interior';
        if (area === 'town' || area === 'hobunji_main_town' || area === 'map_hobunji_town') return 'town';
        if (_isBuildingArea(area)) return area;
        window.__farmLog?.(`[schedule] Unknown area "${area}" → fallback to farm`, 'warn');
        return 'farm';
      }
      function normalizeNpcStation(station, fallbackArea) {
        if (!station || !station.id) return null;
        const c = station.c ?? station.col;
        const r = station.r ?? station.row;
        if (!Number.isFinite(c) || !Number.isFinite(r)) return null;
        return {
          id: station.id,
          label: station.label || station.id,
          area: normalizeNpcArea(station.area || station.mapId || fallbackArea || 'farm'),
          c, r,
          rotY: Number.isFinite(station.rotY) ? station.rotY : 0,
          pose: station.pose || 'stand',
          toolKey: station.toolKey || '',
          toolIntervalSec: Number.isFinite(station.toolIntervalSec) ? station.toolIntervalSec : 0,
          toolAnimStyle: station.toolAnimStyle || '',
        };
      }
      function registerNpcStations(stations, fallbackArea) {
        (stations || []).forEach(st => {
          const normalized = normalizeNpcStation(st, fallbackArea);
          if (normalized) npcStationsById.set(normalized.id, normalized);
        });
      }
      function resolveNpcStationTarget(stationId) {
        const station = npcStationsById.get(stationId);
        return station ? { ...station, stationId: station.id } : null;
      }

      function sceneForNpcArea(area) {
        if (area === 'interior') return interiorScene;
        if (area === 'town') return townScene;
        if (_isBuildingArea(area)) return _buildingScenes.get(area)?.scene || null;
        return scene;
      }
      function npcGridForArea(area) {
        if (area === 'interior') return interiorGrid;
        if (area === 'town') return townGrid;
        if (_isBuildingArea(area)) return _buildingScenes.get(area)?.grid || null;
        return grid;
      }
      function npcSurfaceY(area, c, r) {
        const g = npcGridForArea(area);
        const tile = g?.[r]?.[c];
        return tile ? tileSurfaceY(tile.type) : 0;
      }
      function resolveNpcSpawnPosition(rec, target) {
        const legacy = target?.legacyPath || null;
        if (legacy?.nodes?.length) { const [c, r] = legacy.nodes[0]; return { area: legacy.area || target?.area || 'farm', c, r }; }
        return target;
      }

      const _scheduleFallbackLogKeys = new Set();
      function logScheduleFallbackOnce(rec, kind, area, c, r) {
        const minuteBucket = Math.floor(currentGameMinutes() / 10);
        const key = [rec?.id || 'npc', kind, currentArea, area, c, r, minuteBucket].join('|');
        if (_scheduleFallbackLogKeys.has(key)) return;
        _scheduleFallbackLogKeys.add(key);
        window.__farmLog?.(`[schedule] ${rec?.id || 'npc'}: no rule matched (playerMap=${currentArea}) → fallback ${kind} area=${area} c=${c} r=${r}`, 'warn');
      }

      function resolveNpcScheduleTarget(rec) {
        const hooks = rec?.scheduleHooks || {};
        const now = currentGameMinutes();
        for (const rule of hooks.rules || []) {
          const start = parseNpcTimeMinutes(rule.start ?? rule.from);
          const end   = parseNpcTimeMinutes(rule.end   ?? rule.to);
          const ruleActive = isNowWithinNpcRuleWindow(now, start, end);
          if (ruleActive && rule.stationId) {
            const stationTarget = resolveNpcStationTarget(rule.stationId);
            if (stationTarget) return { ...stationTarget, routeId: rule.routeId || null, activity: rule.activity || '' };
            window.__farmLog?.(`[schedule] ${rec?.id || 'npc'}: stationId "${rule.stationId}" not found`, 'warn');
          }
          const c = rule.c ?? rule.position?.c;
          const r = rule.r ?? rule.position?.r;
          const area = normalizeNpcArea(rule.area ?? rule.mapId ?? hooks.defaultMapId ?? 'town');
          if (ruleActive && Number.isFinite(c) && Number.isFinite(r))
            return { area, c, r, routeId: rule.routeId || null, activity: rule.activity || '' };
        }
        if (hooks.defaultStationId) {
          const stationTarget = resolveNpcStationTarget(hooks.defaultStationId);
          if (stationTarget) return stationTarget;
          window.__farmLog?.(`[schedule] ${rec?.id || 'npc'}: defaultStationId "${hooks.defaultStationId}" not found`, 'warn');
        }
        if (hooks.defaultPosition && Number.isFinite(hooks.defaultPosition.c) && Number.isFinite(hooks.defaultPosition.r)) {
          const defArea = normalizeNpcArea(hooks.defaultPosition.area || hooks.defaultMapId || 'town');
          logScheduleFallbackOnce(rec, 'defaultPosition', defArea, hooks.defaultPosition.c, hooks.defaultPosition.r);
          return { ...hooks.defaultPosition, area: defArea };
        }
        const legacy = worldNpcPaths.find(p => p.npcId === rec?.id);
        if (legacy?.nodes?.length) { const [c, r] = legacy.nodes[legacy.nodes.length - 1]; const legArea = normalizeNpcArea(legacy.area || 'farm'); logScheduleFallbackOnce(rec, 'legacy path', legArea, c, r); return { area: legArea, c, r, legacyPath: legacy }; }
        return null;
      }

      // Pool of transition spots that live "in" the given area, in the same
      // shape checkTransitionSpots() uses for the player.
      function npcTransitionPool(area) {
        if (_isBuildingArea(area)) return _buildingScenes.get(area)?.transitions || [];
        if (area === 'town') return worldTownTransitions;
        return worldTransitions.filter(t => (t.area || 'farm') === area);
      }

      // Resolves the door an NPC should walk to in order to leave `fromArea`
      // for `toArea`, plus the spot they should appear at once they arrive —
      // i.e. the Spot doubles as both the movement target on the way out and
      // the spawn point on the way in, so NPCs are never warped straight to
      // their final schedule target through a wall.
      function findNpcAreaLink(fromArea, toArea) {
        const pool = npcTransitionPool(fromArea);
        if (_isBuildingArea(toArea)) {
          const t = pool.find(x => x.target === 'building' && x.targetMapId === toArea);
          if (!t) return null;
          const bi = _buildingScenes.get(toArea);
          if (!_buildingScenes.has(toArea)) loadBuildingScene(toArea); // warm it up before the NPC reaches the door
          const spawn = bi ? buildingSpawnFromExit(bi, bi.cols, bi.rows)
            : { col: t.targetCol ?? 0, row: t.targetRow ?? 0 };
          return { exit: { c: t.col, r: t.row }, spawn: { c: spawn.col, r: spawn.row } };
        }
        if (_isBuildingArea(fromArea)) {
          const t = pool.find(x => x.target === 'exit_building');
          if (!t) return null;
          const townSpot = worldTownTransitions.find(x => x.target === 'building' && x.targetMapId === fromArea);
          const spawn = townSpot ? { c: townSpot.col, r: townSpot.row } : { c: t.targetCol ?? 0, r: t.targetRow ?? 0 };
          return { exit: { c: t.col, r: t.row }, spawn };
        }
        const t = pool.find(x => x.target === toArea);
        if (!t || !Number.isFinite(t.targetCol) || !Number.isFinite(t.targetRow)) return null;
        return { exit: { c: t.col, r: t.row }, spawn: { c: t.targetCol, r: t.targetRow } };
      }

      async function spawnScheduledNpcs(extraRecords) {
        if (!window.NpcAvatarPreview || !window.PNGPlaneAvatar) return;
        let dbNpcs = extraRecords || [];
        if (!dbNpcs.length) {
          try { const res = await fetch('config/npcs/hobunji-starter-npc-database.json'); const json = await res.json(); dbNpcs = json.npcs || []; } catch {}
        }
        await window.NpcAvatarPreview.ensurePortraitCosmetics({ assetBase: './assets/', configBase: './config/' });
        for (const rec of dbNpcs) {
          const target = resolveNpcScheduleTarget(rec);
          if (!target) { console.warn('[NPC] No schedule target for', rec?.id, '— skipped'); continue; }
          try { const w = await makeNpcWalker(rec, target); if (w) npcWalkers.push(w); }
          catch (e) { console.warn('NPC walker failed for schedule', rec?.id, e); }
        }
        console.log(`[NPC] Spawned ${npcWalkers.length}/${dbNpcs.length} walkers. inspect: window._npcWalkers`);
        console.log('[NPC] Areas:', npcWalkers.map(w => (w.rec?.id || '?') + '@' + (w.area || w.root?._pendingBuildingAdd || (w.root?._pendingTownAdd ? 'town(pending)' : '?'))));
      }

      // Fixed local "right" axis for station tool-swing animation — see makeNpcWalker.
      const NPC_TOOL_SWING_AXIS = new THREE.Vector3(-1, 0, 0);

      async function makeNpcWalker(rec, initialTarget) {
        const guessSpecies = (rec?.species || '').toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
        const appearance = (rec?.appearance && rec.appearance.speciesId) ? rec.appearance : {
          speciesId: NPC_SPECIES_IDS.includes(guessSpecies) ? guessSpecies : undefined,
          gender: rec?.gender === 'female' ? 'female' : 'male',
          cosmetics: {},
        };
        const profile = window.NpcAvatarPreview.buildProfileFromNpcExport({
          name: rec?.name || rec?.id || 'npc',
          appearance,
          equippedCosmetics: rec?.equippedCosmetics || [],
          appliedDyes: rec?.appliedDyes || {},
        });
        if (!profile) return null;

        const avatarCfg = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar || {};
        const MODEL_W = avatarCfg.worldModelWidth ?? 0.9;
        const PORTRAIT_SIZE = avatarCfg.previewPortraitCanvasSize ?? 200;
        const frontCanvas = document.createElement('canvas');
        frontCanvas.width = frontCanvas.height = PORTRAIT_SIZE;
        await window.NpcAvatarPreview.renderProfileToCanvas(frontCanvas, profile);
        const backCanvas = document.createElement('canvas');
        backCanvas.width = backCanvas.height = PORTRAIT_SIZE;
        await window.NpcAvatarPreview.renderProfileToCanvas(backCanvas, profile, { portraitView: 'behind' });

        const avatarGroup = window.PNGPlaneAvatar.buildSinglePlaneAvatarModel(
          THREE, frontCanvas,
          { backCanvas, profile, npcRecord: rec, modelWidth: MODEL_W, modelHeight: MODEL_W, anchorZ: 0, alphaTest: avatarCfg.worldAlphaTest ?? 0.01 }
        );
        const avatarHeight = avatarGroup.userData?.portraitModelHeight || MODEL_W;
        avatarGroup.position.set(0, avatarHeight / 2, 0);
        _markPngPlane(avatarGroup);
        const root = new THREE.Group();
        root.name = 'npc_walker_' + (rec?.id || rec?.name || '');
        const groundShadow = makeCharacterGroundShadow('npc_ground_shadow');
        root.add(groundShadow);
        root.add(avatarGroup);

        const spawnTarget = resolveNpcSpawnPosition(rec, initialTarget);
        const spawnArea = normalizeNpcArea(spawnTarget.area);
        root.position.set(spawnTarget.c + 0.5, npcSurfaceY(spawnArea, spawnTarget.c, spawnTarget.r), spawnTarget.r + 0.5);
        const sc = sceneForNpcArea(spawnArea);
        if (sc) { sc.add(root); root._npcScene = sc; root._pendingTownAdd = false; root._pendingBuildingAdd = null; }
        else if (spawnArea === 'town') { root._npcScene = null; root._pendingTownAdd = true; root._pendingBuildingAdd = null; }
        else if (_isBuildingArea(spawnArea)) {
          root._npcScene = null; root._pendingTownAdd = false; root._pendingBuildingAdd = spawnArea;
          if (!_buildingScenes.has(spawnArea)) loadBuildingScene(spawnArea);
        } else { scene.add(root); root._npcScene = scene; root._pendingTownAdd = false; root._pendingBuildingAdd = null; }

        const walker = {
          root, rec, profile, avatarGroup, avatarFrontCanvas: frontCanvas, avatarBackCanvas: backCanvas, area: spawnArea,
          state: 'idle', routeNode: null, routeTarget: null, routePath: null, _exitSpot: null, _entrySpot: null,
          pause: 0, catchup: 1, catchupDur: 0,
          rot: Math.PI / 2, perpState: {}, stationToolKey: '', stationToolMesh: null, stationToolT: 0,
          resetRouteState() {
            this.state = 'idle';
            this.routeNode = null;
            this.routeTarget = null;
            this.routePath = null;
            this._routePathTargetKey = null;
          },
          // `spawnPos` is where the NPC reappears in `nextArea` — normally the
          // Spot they're entering through, never the final schedule target,
          // so they always walk the last leg into view instead of popping in.
          transferToArea(nextArea, spawnPos) {
            const area = nextArea; // caller passes pre-normalized area
            if (area === this.area) return;
            if (root._npcScene) root._npcScene.remove(root);
            else { scene.remove(root); interiorScene?.remove(root); townScene?.remove(root); }
            _buildingScenes.forEach(bi => bi?.scene?.remove(root));
            root._pendingTownAdd = false; root._pendingBuildingAdd = null;
            const nextScene = sceneForNpcArea(area);
            if (nextScene) { nextScene.add(root); root._npcScene = nextScene; }
            else if (area === 'town') { root._npcScene = null; root._pendingTownAdd = true; }
            else if (_isBuildingArea(area)) {
              root._npcScene = null; root._pendingBuildingAdd = area;
              if (!_buildingScenes.has(area)) loadBuildingScene(area);
            } else { scene.add(root); root._npcScene = scene; }
            this.area = area;
            this.resetRouteState();
            root.position.set(spawnPos.c + 0.5, _isBuildingArea(area) ? 0 : npcSurfaceY(area, spawnPos.c, spawnPos.r), spawnPos.r + 0.5);
          },
          // Surface/interior-aware placeholder footstep hook — shared by every
          // NPC movement path since they all funnel through moveToward().
          _tickFootsteps(distTiles) {
            if (this.area !== currentArea) return; // not in the player's current area; inaudible
            if (!_footstepAdvance(this, distTiles * TILE)) return;
            const wx = root.position.x * TILE, wy = root.position.z * TILE;
            const distToPlayer = Math.hypot(wx - player.x, wy - player.y);
            if (distToPlayer > FOOTSTEP_EARSHOT_PX) return;
            const falloff = Math.pow(Math.max(0, 1 - distToPlayer / FOOTSTEP_EARSHOT_PX), 2);
            const pan = Math.max(-1, Math.min(1, (wx - player.x) / FOOTSTEP_PAN_RANGE_PX));
            const type = footstepTileTypeAt(this.area, wx, wy, npcGridForArea(this.area));
            playFootstepSfx(this.area, type, falloff, pan);
          },
          moveToward(tx, tz, dt) {
            const cfg = npcMovementConfig();
            const speed = (cfg.speedTilesPerSecond ?? 1.25) * this.catchup;
            const dx = tx - root.position.x, dz = tz - root.position.z;
            const d = Math.hypot(dx, dz);
            if (d <= Math.max(0.001, speed * dt)) {
              this._tickFootsteps(d);
              root.position.x = tx; root.position.z = tz; return true;
            }
            const movedTiles = speed * dt;
            root.position.x += dx / d * movedTiles;
            root.position.z += dz / d * movedTiles;
            this._tickFootsteps(movedTiles);
            const rawRot = -Math.atan2(dz, dx) + Math.PI / 2;
            const { effectiveTarget, snapTo } = perpClamp(this.perpState, rawRot, cameraRelativePerps());
            if (snapTo !== null) this.rot = effectiveTarget;
            else this.rot += angleDiff(effectiveTarget, this.rot) * 0.15;
            root.rotation.y = this.rot;
            return false;
          },
          update(dt) {
            if (this.pause === Infinity) return;
            const target = resolveNpcScheduleTarget(this.rec);
            this.currentScheduleTarget = target || null;
            if (!target) return;
            const targetArea = normalizeNpcArea(target.area);
            if (targetArea !== this.area) {
              if (!this._exitSpot) {
                const link = findNpcAreaLink(this.area, targetArea);
                if (link) { this._exitSpot = link.exit; this._entrySpot = link.spawn; }
              }
              if (this._exitSpot) {
                const ex = this._exitSpot.c + 0.5, ez = this._exitSpot.r + 0.5;
                const arrival = npcMovementConfig().arrivalRadiusTiles ?? 0.18;
                if (Math.hypot(root.position.x - ex, root.position.z - ez) <= arrival) {
                  window.__farmLog?.(`[schedule] ${rec?.id || 'npc'}: transferring via exit spot "${this.area}"→"${targetArea}" | playerMap="${currentArea}"`, 'info');
                  const spawn = this._entrySpot || this._exitSpot;
                  this._exitSpot = null; this._entrySpot = null;
                  this.transferToArea(targetArea, spawn);
                } else {
                  this.moveToward(ex, ez, dt);
                }
                return;
              }
              window.__farmLog?.(`[schedule] ${rec?.id || 'npc'}: instant transfer "${this.area}"→"${targetArea}" (no exit spot — area link missing in map data)`, 'info');
              this.transferToArea(targetArea, target);
              return;
            }
            this._exitSpot = null;
            const cfg = npcMovementConfig();
            const tx = target.c + 0.5, tz = target.r + 0.5;
            const arrival = cfg.arrivalRadiusTiles ?? 0.18;
            if (Math.hypot(root.position.x - tx, root.position.z - tz) <= arrival) this.state = 'idle';
            if (this.state === 'idle' && Math.hypot(root.position.x - tx, root.position.z - tz) <= arrival) {
              const groundY = npcSurfaceY(this.area, target.c, target.r);
              root.position.y = groundY + Math.sin(performance.now() / 600) * 0.005;
              if (Number.isFinite(target.rotY)) { this.rot = THREE.MathUtils.degToRad(target.rotY); root.rotation.y = this.rot; }
              if (target.toolKey && typeof makeToolPlaneMesh === 'function') {
                if (this.stationToolKey !== target.toolKey) {
                  if (this.stationToolMesh) root.remove(this.stationToolMesh);
                  this.stationToolMesh = makeToolPlaneMesh(target.toolKey);
                  this.stationToolKey = this.stationToolMesh ? target.toolKey : '';
                  if (this.stationToolMesh) root.add(this.stationToolMesh);
                }
                if (this.stationToolMesh) {
                  // Repeats the player's own chop/thrust swing curve (see updateToolMesh)
                  // entirely in root-local space: the mesh is a child of `root`, so root's
                  // own rotation.y already carries this NPC's facing — using the fixed
                  // local right/forward axes here reproduces the player's world-space
                  // swing for whichever way this NPC happens to be facing.
                  const interval = Math.max(0.2, target.toolIntervalSec || 2);
                  this.stationToolT = (this.stationToolT + dt) % interval;
                  const progress = this.stationToolT / interval;
                  const anim = target.toolAnimStyle || TOOL_ITEM_DEFS[target.toolKey]?.animStyle || 'chop';
                  const WF = 0.16, SF = 0.28;
                  let swingAngle = 0, fwdOff = 0;
                  if (anim === 'thrust') {
                    swingAngle = 0.18;
                    if (progress <= WF) fwdOff = -0.22 * (progress / WF);
                    else if (progress <= SF) fwdOff = -0.22 + 0.54 * ((progress - WF) / (SF - WF));
                    else fwdOff = 0.32 * (1.0 - (progress - SF) / (1.0 - SF));
                  } else {
                    if (progress <= WF) swingAngle = 0.82 + 0.98 * (progress / WF);
                    else if (progress <= SF) swingAngle = 1.80 - 3.30 * ((progress - WF) / (SF - WF));
                    else swingAngle = -1.50 + 2.32 * ((progress - SF) / (1.0 - SF));
                  }
                  this.stationToolMesh.position.set(-0.28, 0.18, fwdOff);
                  this.stationToolMesh.quaternion.setFromAxisAngle(NPC_TOOL_SWING_AXIS, swingAngle);
                }
              } else if (this.stationToolMesh) {
                root.remove(this.stationToolMesh); this.stationToolMesh = null; this.stationToolKey = '';
              }
              groundShadow.position.y = groundY - root.position.y + characterGroundShadowSurfaceOffset();
              return;
            }
            if (this.stationToolMesh) { root.remove(this.stationToolMesh); this.stationToolMesh = null; this.stationToolKey = ''; }
            if (this.catchupDur > 0) { this.catchupDur -= dt; if (this.catchupDur <= 0) { this.catchupDur = 0; this.catchup = 1; } }
            if (!target.routeId && canNpcBeeline(this.area, root.position.x, root.position.z, target.c, target.r)) {
              this.state = 'beeline'; this.routeNode = this.routeTarget = this.routePath = null; this._routePathTargetKey = null;
              this.moveToward(tx, tz, dt);
            } else if (this.state !== 'on-route') {
              this.routeTarget = findNearestRouteNode(this.area, root.position.x, root.position.z, target);
              // Don't wade to the route node — if the direct line there crosses
              // water, wait instead (no off-route dry path is computed here).
              if (this.routeTarget && !canNpcBeeline(this.area, root.position.x, root.position.z, this.routeTarget.c, this.routeTarget.r)) {
                this.routeTarget = null;
              }
              this.state = this.routeTarget ? 'to-route' : 'idle';
              if (this.routeTarget) this.moveToward(this.routeTarget.c + 0.5, this.routeTarget.r + 0.5, dt);
            } else {
              // Walk a precomputed shortest path hop-by-hop instead of greedily
              // picking whichever neighbor looks closer right now — the greedy
              // version stalls forever at junction nodes (often doorways) where
              // every immediate neighbor is briefly no closer than "here".
              const targetKey = target.routeId + '|' + target.c + ',' + target.r;
              if (!this.routePath || this._routePathTargetKey !== targetKey) {
                this.routePath = computeRoutePathToTarget(this.routeNode, target);
                this._routePathTargetKey = targetKey;
              }
              if (!this.routePath || !this.routePath.length) { this.state = 'breakoff'; return; }
              const nextHop = this.routePath[0];
              if (this.moveToward(nextHop.c + 0.5, nextHop.r + 0.5, dt)) {
                this.routeNode = nextHop;
                this.routePath.shift();
              }
            }
            if (this.state === 'to-route' && this.routeTarget && Math.hypot(root.position.x - (this.routeTarget.c + 0.5), root.position.z - (this.routeTarget.r + 0.5)) <= arrival) {
              this.routeNode = this.routeTarget; this.routeTarget = null; this.routePath = null; this.state = 'on-route';
            }
            if (this.state === 'breakoff') this.state = 'idle';
            const ty = npcSurfaceY(this.area, Math.floor(root.position.x), Math.floor(root.position.z));
            root.position.y += (ty - root.position.y) * 0.2;
            root.position.y += Math.sin(performance.now() / 140) * 0.012;
            groundShadow.position.y = ty - root.position.y + characterGroundShadowSurfaceOffset();
          },
        };
        return walker;
      }

      // Fires once the screen is fully black on a player area transition.
      // Any NPC who was already mid-transit between the same two areas (i.e.
      // their goal-based schedule has them leaving exactly where the player
      // is leaving, headed exactly where the player is headed) finishes its
      // walk through the door right now instead of over the next several
      // seconds, and is nudged a tile past the spawn point in the direction
      // of travel. The black screen hides the pop-in, so when it clears the
      // NPC simply looks like it left a step ahead of the player — "caught"
      // leaving instead of teleporting in front of them.
      function catchNpcsOnPlayerAreaTransition(fromArea, toArea) {
        for (const w of npcWalkers) {
          if (w.area !== fromArea) continue;
          const target = resolveNpcScheduleTarget(w.rec);
          if (!target) continue;
          if (normalizeNpcArea(target.area) !== toArea) continue;
          const link = (w._exitSpot && w._entrySpot) ? { exit: w._exitSpot, spawn: w._entrySpot } : findNpcAreaLink(fromArea, toArea);
          if (!link) continue;
          w._exitSpot = null; w._entrySpot = null;
          w.transferToArea(toArea, link.spawn);
          const dx = link.spawn.c - link.exit.c, dz = link.spawn.r - link.exit.r;
          const dist = Math.hypot(dx, dz);
          if (dist > 0) {
            const nc = Math.floor(link.spawn.c + dx / dist);
            const nr = Math.floor(link.spawn.r + dz / dist);
            if (isNpcTileWalkable(toArea, nc, nr)) {
              w.root.position.x = nc + 0.5;
              w.root.position.z = nr + 0.5;
              w.root.position.y = npcSurfaceY(toArea, nc, nr);
              w.rot = -Math.atan2(dz, dx) + Math.PI / 2;
              w.root.rotation.y = w.rot;
            }
          }
        }
      }

      function updateNpcWalkers(dt) {
        const previousNearbyNpcWalker = nearbyNpcWalker;
        for (const w of npcWalkers) w.update(dt);
        let closest = null, closestDist = npcMovementConfig().interactionRadiusTiles ?? 2.0;
        const px = player.x / TILE, pz = player.y / TILE;
        for (const w of npcWalkers) {
          if (w.area !== currentArea) continue;
          const d = Math.hypot(w.root.position.x - px, w.root.position.z - pz);
          if (d < closestDist) { closestDist = d; closest = w; }
        }
        nearbyNpcWalker = closest;
        if (previousNearbyNpcWalker !== nearbyNpcWalker) refreshActionBar();
      }

      // ── Town zone ──────────────────────────────────────────────────
      // Loads the town layout from the workspace JSON file.
      // Mirrors the map editor's buildTownLayout() conversion.
      async function _loadTownFromWorkspace() {
        try {
          // One-shot override: docs/tools/index.html's "Open Game" button stashes the
          // map editor's live (possibly unsaved) workspace here so testing in-progress
          // edits doesn't require exporting to the on-disk JSON first. Consumed once —
          // cleared immediately so a plain reload goes back to the real saved file.
          const GAME_WS_OVERRIDE_KEY = 'hobunji_game_workspace_override_v1';
          let ws;
          const overrideRaw = localStorage.getItem(GAME_WS_OVERRIDE_KEY);
          if (overrideRaw) {
            localStorage.removeItem(GAME_WS_OVERRIDE_KEY);
            try {
              ws = JSON.parse(overrideRaw);
              console.log('%c[workspace] using live unsaved map-editor data from "Open Game"', 'color:#22c55e;font-weight:bold');
            } catch (_) { ws = null; }
          }
          if (!ws) {
            const resp = await fetch('config/town-workspace-v1.json');
            if (!resp.ok) return;
            ws = await resp.json();
          }
          // Load map index so individual map files take priority over workspace inline data
          let mapFileIndex = {};
          try {
            const idxResp = await fetch('config/maps/index.json');
            if (idxResp.ok) {
              const idx = await idxResp.json();
              for (const e of (idx.maps || [])) if (e.id && e.file) mapFileIndex[e.id] = e.file;
            }
          } catch(_) {}
          // Resolve each map: fetch from file if listed in index, fall back to workspace inline data
          const resolvedMaps = await Promise.all((ws.maps || []).map(async m => {
            const file = mapFileIndex[m.id];
            if (!file) return m;
            try {
              const r = await fetch(file);
              if (!r.ok) return m;
              const data = await r.json();
              // If the file is an Interior Editor layout and the workspace entry is Map Editor
              // format, keep the workspace version (source of truth for game logic) and attach
              // the file as visual base so loadBuildingScene can still render the room.
              if (data?.schema === 'hobunji_building_interior.v1' && m?.schema !== 'hobunji_building_interior.v1') {
                return { ...m, buildingInteriorBase: data };
              }
              // Normalise tiles: array [{c,r,type,crop}] → dict {"c,r":{type,crop}}
              if (Array.isArray(data.tiles)) {
                const d = {};
                for (const t of data.tiles) d[`${t.c},${t.r}`] = { type: t.type, crop: t.crop || '' };
                data.tiles = d;
              }
              return data;
            } catch(_) { return m; }
          }));
          _workspaceMaps = resolvedMaps;

          // Plateau sub-maps are purely an authoring convenience in the Map Editor —
          // in-game every tier of a plateau stack is merged into its root zone's
          // single grid (see tileSurfaceYInArea / buildZoneScene), so only root
          // (non-submap) exterior maps get their own zone entry below.
          const childByParentGroup = new Map();
          for (const m of resolvedMaps) {
            if (m.isSubmap && m.parentMapId && m.plateauGroupId) {
              childByParentGroup.set(`${m.parentMapId}__${m.plateauGroupId}`, m);
            }
          }
          const plateauElevById = new Map((ws.plateauGroups || []).map(g => [g.id, g.elevation || 0]));

          // Recursively folds map `m` (placed at world offset `offsetC`/`offsetR`,
          // floor elevation tier `baseTier`) into `outTiles` (world-keyed "c,r"
          // → tile). Every plateau group's elevation is absolute, measured from the
          // root map, so a group's stored elevation IS the final tier its tiles
          // render at. Plateau groups are always painted as siblings directly on
          // the root zone map (the Map Editor no longer allows painting a plateau
          // group onto another plateau group's sub-map), so `m` here is normally
          // the root zone itself — `baseTier` is just that root's own floor (0)
          // for the outermost call, and a tier's resolved `toTier` for the one
          // recursive call into each sibling's own (otherwise plateau-free)
          // sub-map below, to fold in that tier's own ramps/buildings/decor. A
          // tier's footprint is the bounding box of whichever tiles on the root
          // are actually tagged `plateau: <thisGroupId>` — the artist paints
          // however large a region they want a tier to occupy. The OUTER 1-tile
          // ring of that painted bbox is reserved (automatically, not by
          // painting) as the cliff-face lerp between this tier and whatever sits
          // immediately around it — another sibling tier's footprint if one is
          // adjacent (so two plateaus sharing this map blend straight into each
          // other instead of each sloping all the way down to baseTier), or true
          // ungraded ground otherwise. Ring cells are flagged `incline`
          // (always solid/impassable — see tileSpeedAt) unless the map explicitly
          // paints something else there (a ramp tile, typically), which always
          // wins over the auto-incline. The child sub-map's own local (0,0) is
          // placed one tile inside that ring, i.e. at the bbox's top-left corner + 1.
          // Whenever a plateau group actually has an authored child submap, this
          // also records a `{minC,maxC,minR,maxR,fromTier,toTier}` mesa entry (in
          // world coords) for the continuous heightfield buildZoneScene renders at
          // that tier transition. Also folds `m.buildings` (placed by the Map
          // Editor on this root zone or any of its plateau-tier sub-maps) into
          // `outBuildings`/`outDecor`/`outFurniture`, translating their authored
          // local col/row (gridX/gridZ for buildings) by the same offsetC/offsetR
          // every tile here gets, so a building/decor/furniture piece on a raised
          // sub-map ends up at its correct world position — its final `elevTier`
          // is resolved by the caller from `outTiles` once the whole stack is in,
          // so houses, decor, and processing furniture all sit on top of whatever
          // plateau tier their anchor cell landed on instead of at ground level.
          function mergeZoneTiles(m, offsetC, offsetR, baseTier, outTiles, mesas, outBuildings, outDecor, outFurniture) {
            const groupMask = new Map(); // plateauGroupId -> Set of parent-local "c,r" actually painted
            for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
              const plateauId = m.tiles?.[`${c},${r}`]?.plateau;
              if (!plateauId) continue;
              let mask = groupMask.get(plateauId);
              if (!mask) { mask = new Set(); groupMask.set(plateauId, mask); }
              mask.add(`${c},${r}`);
            }
            // Every plateau group painted on `m` is a sibling here (painting one
            // group's brush over another's cells reassigns them — see applyAt — so
            // groupMask's per-group masks are already disjoint). A ring cell's real
            // support height is therefore whichever group (if any) owns its missing
            // neighbor, not always this map's own baseTier — that's what lets two
            // plateaus sharing this map blend straight into each other (a lower
            // tier's cells bordering a higher sibling's footprint stay flat at their
            // own tier instead of sloping down to baseTier, since the riser is
            // entirely the higher sibling's own mesa wall) while a true outer edge
            // (bordering ungraded ground, or a still-lower sibling) still ramps down.
            const tierAt = (c, r) => {
              const pid = m.tiles?.[`${c},${r}`]?.plateau;
              return pid ? (plateauElevById.get(pid) || 0) : baseTier;
            };

            // Stake out each recursing group's footprint (incline ring + raised
            // interior) BEFORE writing this map's own tiles below, so any tile `m`
            // explicitly authored inside that footprint (a ramp cut through the
            // incline ring, a plateau marker, etc.) always overwrites/wins. Only the
            // ACTUAL painted shape is staked — not its bounding rectangle — so a
            // genuine concave/irregular footprint's "gap" cells (inside the bbox,
            // unpainted, and not just a stray pinhole — see the fill pass below)
            // are left untouched here and fall through to this map's own per-cell
            // loop below, which fills them in as ordinary ground at this tier
            // instead of getting raised along with the rest of the rectangle.
            const children = [];
            for (const [gid, mask] of groupMask) {
              const child = childByParentGroup.get(`${m.id}__${gid}`);
              if (!child) continue; // plateau group marked but no authored child submap yet
              const toTier = (plateauElevById.get(gid) || 0);
              let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
              for (const k of mask) { const [c, r] = k.split(',').map(Number); if (c<minC)minC=c; if (c>maxC)maxC=c; if (r<minR)minR=r; if (r>maxR)maxR=r; }

              // A brush stroke can leave a single un-stamped pinhole inside an
              // otherwise-solid blob (the circular stamp's own rounding, or a
              // missed click) — that cell has NO tile entry at all, so it isn't a
              // deliberate concave notch, just a gap. Adopt any untouched cell
              // that's mostly surrounded by this same mask (3+ of its 4 cardinal
              // neighbors already painted) into the mask too, so it gets raised
              // and ringed along with the rest of the blob instead of sinking
              // back to flat ground in the middle of the mesa. Iterate so a short
              // chain of adjacent pinholes fills in one cell at a time; capped so
              // a genuinely open notch (few neighbors painted at any point along
              // it) is left alone.
              for (let pass = 0; pass < 8; pass++) {
                let filled = false;
                for (let r = minR; r <= maxR; r++) {
                  for (let c = minC; c <= maxC; c++) {
                    const k = `${c},${r}`;
                    if (mask.has(k) || m.tiles?.[k]) continue;
                    const neighborCount = [[1,0],[-1,0],[0,1],[0,-1]].filter(([dc,dr]) => mask.has(`${c+dc},${r+dr}`)).length;
                    if (neighborCount >= 3) { mask.add(k); filled = true; }
                  }
                }
                if (!filled) break;
              }

              const worldMinC = offsetC + minC, worldMaxC = offsetC + maxC, worldMinR = offsetR + minR, worldMaxR = offsetR + maxR;
              const maskWorldKeys = new Set();
              for (const k of mask) { const [c, r] = k.split(',').map(Number); maskWorldKeys.add(`${c + offsetC},${r + offsetR}`); }
              mesas.push({ minC: worldMinC, maxC: worldMaxC, minR: worldMinR, maxR: worldMaxR, fromTier: baseTier, toTier, maskWorldKeys, groupId: gid });
              for (const k of mask) {
                const [lc, lr] = k.split(',').map(Number);
                const c = lc + offsetC, r = lr + offsetR;
                // A generated wilderness zone's entry gate corridor (see
                // openBorderEntryGate in wilderness-map-generator.js) is a
                // deliberately flattened, walkable cut through the boundary
                // cliff ring — it's always at the outer edge of its plateau's
                // mask (right at the map border), which is exactly what the
                // ring check below treats as a sloped/impassable cliff face.
                // Force it to the group's real (interior, non-incline) tier
                // instead of computing ring-ness for it, or the entrance
                // itself becomes solid to the game's own movement collision
                // (see tileSpeedAt's `if (tile.incline) return null`).
                if (m.tiles?.[k]?.borderEntryGate) {
                  outTiles.set(`${c},${r}`, { c, r, type: 'grass', elevTier: toTier, skipFloor: true, rampElevation: 0, incline: false });
                  continue;
                }
                let ringTier = null; // null => fully interior, no slope needed here
                for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                  if (mask.has(`${lc+dc},${lr+dr}`)) continue;
                  const supportTier = tierAt(lc+dc, lr+dr);
                  if (supportTier < toTier) ringTier = ringTier === null ? supportTier : Math.min(ringTier, supportTier);
                }
                const onRing = ringTier !== null;
                outTiles.set(`${c},${r}`, {
                  c, r, type: 'grass', elevTier: onRing ? ringTier : toTier,
                  skipFloor: true, rampElevation: 0, incline: onRing,
                });
              }
              children.push({ child, childOffsetC: worldMinC + 1, childOffsetR: worldMinR + 1, toTier });
            }

            // `m.tiles` is sparse — most cells (including almost all of a plateau
            // submap's own extent, which artists only ever paint a handful of
            // marker/ramp tiles on) have no entry. Explicit NON-plateau-tagged
            // tiles always win over the bulk pre-fill above (this is how a ramp
            // cuts through the auto-incline ring: paintRampTiles strips the
            // `.plateau` tag from any cell it stamps, so it falls through here).
            // A missing entry, OR an entry that's still tagged `.plateau` (i.e.
            // it's part of the painted footprint shape itself, not a deliberate
            // override), must NOT stomp the ring/interior staking already written
            // above — only default to flat grass if no caller has touched this
            // world cell yet.
            for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
              const t = m.tiles?.[`${c},${r}`];
              const key = `${c + offsetC},${r + offsetR}`;
              if (!t || t.plateau) {
                if (!outTiles.has(key)) outTiles.set(key, { c: c + offsetC, r: r + offsetR, type: 'grass', elevTier: baseTier, skipFloor: false, rampElevation: 0, incline: false });
                continue;
              }
              let type = t.type || 'grass';
              // Decorative (non-plateau) rock tiles are always-solid in the engine
              // (isSolid()), and Northern Cliffs' authored data scatters hundreds of
              // them across the walkable ground — turn the un-tagged ones back to
              // grass so the real plateau cliff-face (plateau-tagged rock) reads as
              // the only solid rock terrain, and the zone is actually walkable.
              if (!t.plateau && type === 'rock') type = 'grass';
              outTiles.set(key, {
                c: c + offsetC, r: r + offsetR, type, elevTier: baseTier, skipFloor: false,
                rampElevation: type === 'ramp' ? (t.rampElevation || 0) : 0, incline: false,
              });
            }

            for (const b of (m.buildings || [])) {
              outBuildings.push({ ...b, gridX: (b.gridX || 0) + offsetC, gridZ: (b.gridZ || 0) + offsetR, _baseTier: baseTier });
            }
            for (const d of (m.decor || [])) {
              outDecor.push({ ...d, col: (d.col || 0) + offsetC, row: (d.row || 0) + offsetR, _baseTier: baseTier });
            }
            for (const f of (m.furniture || [])) {
              outFurniture.push({ ...f, col: (f.col || 0) + offsetC, row: (f.row || 0) + offsetR, _baseTier: baseTier });
            }

            for (const { child, childOffsetC, childOffsetR, toTier } of children) {
              mergeZoneTiles(child, childOffsetC, childOffsetR, toTier, outTiles, mesas, outBuildings, outDecor, outFurniture);
            }
          }

          // Resolve real authored tile/transition data for every top-level exterior
          // zone (Northern Cliffs, Southern Cloud Forest) so buildZoneScene can
          // render actual cliff/terrain content instead of EXTERIOR_ZONES' tiny flat
          // placeholder grid.
          const allZoneMapIds = new Set(Object.keys(EXTERIOR_ZONES));
          for (const m of resolvedMaps) {
            if (m.category === 'exterior' && m.id !== 'map_hobunji_town' && !m.isSubmap) allZoneMapIds.add(m.id);
          }

          for (const zoneMapId of allZoneMapIds) {
            const zm = resolvedMaps.find(m => m.id === zoneMapId);
            if (!zm) continue;
            const outTiles = new Map(), mesas = [], outBuildings = [], outDecor = [], outFurniture = [];
            mergeZoneTiles(zm, 0, 0, 0, outTiles, mesas, outBuildings, outDecor, outFurniture);
            const zTiles = [...outTiles.values()];
            for (const b of outBuildings) {
              const t = outTiles.get(`${b.gridX},${b.gridZ}`);
              b.elevTier = (t && typeof t.elevTier === 'number') ? t.elevTier : (b._baseTier || 0);
              delete b._baseTier;
            }
            for (const d of outDecor) {
              const t = outTiles.get(`${d.col},${d.row}`);
              d.elevTier = (t && typeof t.elevTier === 'number') ? t.elevTier : (d._baseTier || 0);
              delete d._baseTier;
            }
            for (const f of outFurniture) {
              const t = outTiles.get(`${f.col},${f.row}`);
              f.elevTier = (t && typeof t.elevTier === 'number') ? t.elevTier : (f._baseTier || 0);
              delete f._baseTier;
            }
            const zTransitions = [];
            let toTownExit = null;
            (zm.transitions || []).forEach(t => {
              if (!t.targetMapId) return;
              if (t.targetMapId === 'map_hobunji_town') {
                // Real authored exit back to town — buildZoneScene uses this position
                // (instead of EXTERIOR_ZONES' placeholder exitCol/exitRow) for the
                // "Back to Town" transition, so the gold ring lands where the map
                // was actually drawn to connect to town.
                if (!toTownExit) toTownExit = t;
              } else if (_isBuildingArea(t.targetMapId)) {
                zTransitions.push({ id: t.id, label: t.label, col: t.col, row: t.row, target: 'building', targetMapId: t.targetMapId });
              } else if (allZoneMapIds.has(t.targetMapId)) {
                zTransitions.push({ id: t.id, label: t.label, col: t.col, row: t.row, target: 'zone', targetMapId: t.targetMapId });
              }
            });
            _zoneLayouts.set(zoneMapId, { cols: zm.cols, rows: zm.rows, tiles: zTiles, transitions: zTransitions, toTownExit, mesas, buildings: outBuildings, decor: outDecor, furniture: outFurniture });
            console.log(`%c[zone:${zoneMapId}] loaded ${zm.cols}x${zm.rows}, tiles=${zTiles.length}, mesas=${mesas.length}, buildings=${outBuildings.length}, decor=${outDecor.length}, furniture=${outFurniture.length}, toTownExit=${toTownExit ? `(${toTownExit.col},${toTownExit.row})` : 'none (using placeholder)'}, zoneTransitions=${zTransitions.length}`, 'color:#22c55e;font-weight:bold');
          }
          const townM = resolvedMaps.find(m => m.id === 'map_hobunji_town');
          if (!townM) return;
          const layout = { version: 1, name: townM.name || 'Hobunji Hollow — Town', cols: townM.cols, rows: townM.rows, tiles: [], npcPaths: [], transitions: [], npcStations: [], buildings: townM.buildings || [] };
          for (let r = 0; r < townM.rows; r++) for (let c = 0; c < townM.cols; c++) {
            const t = townM.tiles[`${c},${r}`];
            if (t) layout.tiles.push({ c, r, type: t.type || 'grass' });
          }
          layout.routes = [];
          (townM.routes || townM.npcPaths || []).forEach(p => {
            if (!p.nodes?.length) return;
            layout.routes.push({ id: p.id, label: p.label, area: 'town', nodes: p.nodes.map(n => [n[0], n[1]]) });
          });
          (townM.npcPaths || []).forEach(p => {
            if (!p.nodes?.length || (townM.routes || []).length) return;
            layout.npcPaths.push({ id: p.id, label: p.label, npcId: p.npcId || '', area: 'town', nodes: p.nodes.map(n => [n[0], n[1]]) });
          });
          resolvedMaps.forEach(m => {
            const area = m.id === townM.id ? 'town' : m.id;
            (m.npcStations || []).forEach(st => layout.npcStations.push({ ...st, area }));
          });
          (townM.transitions || []).forEach(t => {
            // Farm spot (no targetMapId) — returns player to farm exit at col 17, row 0
            if (!t.targetMapId) {
              layout.transitions.push({ id: t.id, label: t.label, area: 'town', col: t.col, row: t.row, target: 'farm', targetCol: 17, targetRow: 0 });
            } else if (_isBuildingArea(t.targetMapId)) {
              layout.transitions.push({ id: t.id, label: t.label, area: 'town', col: t.col, row: t.row, target: 'building', targetMapId: t.targetMapId });
            } else if (allZoneMapIds.has(t.targetMapId)) {
              layout.transitions.push({ id: t.id, label: t.label, area: 'town', col: t.col, row: t.row, target: 'zone', targetMapId: t.targetMapId });
            }
          });
          initTownTravel(layout);
        } catch(e) { debugLog('Town workspace load failed: ' + e.message, 'warn'); }
      }

      function initTownTravel(layout) {
        if (!layout || layout.version !== 1) return;
        _townZone = layout;
        const TCOLS = layout.cols || 60, TROWS = layout.rows || 50;
        townGrid = Array.from({ length: TROWS }, (_, r) =>
          Array.from({ length: TCOLS }, (_, c) => ({
            type: TileType.GRASS, water: 0, crop: CropType.NONE,
            cropAge: 0, cropReady: false, stress: '', variation: 0,
          }))
        );
        for (const { c, r, type } of (layout.tiles || [])) {
          if (townGrid[r]?.[c]) townGrid[r][c].type = type || TileType.GRASS;
        }
        worldTownTransitions = (layout.transitions || []).filter(t =>
          t && Number.isFinite(t.col) && Number.isFinite(t.row) && (
            (Number.isFinite(t.targetCol) && Number.isFinite(t.targetRow)) ||
            (t.target === 'building' && t.targetMapId) ||
            (t.target === 'zone' && t.targetMapId)
          ));
        const townPaths = (layout.npcPaths || []).filter(p =>
          p && Array.isArray(p.nodes) && p.nodes.length > 0 && p.area === 'town');
        worldTownRoutes = normalizeRoutes(layout.routes, townPaths).map(r => ({ ...r, area: 'town' }));
        registerNpcStations(layout.npcStations, 'town');
        registerMapAudio(layout.mapAudio);
        rebuildRouteGraphs();
        // If town scene was already built before this layout arrived, spawn buildings now
        if (_townSceneBuilt && townScene) {
          _townBuildingDefs = _detectTownBuildings();
          _spawnTownBuildings();
        }
      }

      // ── Building interior scenes ─────────────────────────────────────

      // Generates WallBuilder panels for a rectangular room. Walls always sit at
      // the footprint boundary. A 2-tile door gap is cut in whichever wall the exit
      // transition sits on; the gap is centred on the transition column/row.
      function buildWallPanelsForRoom(cols, rows, wallHeight, exitTransition) {
        const DOOR_W = 2;
        const panels = [];
        // Determine which wall the exit is on (S/N/W/E) by proximity to boundary
        let doorWall = null, doorPos = 0;
        if (exitTransition) {
          const { col: ec, row: er } = exitTransition;
          const dS = rows - 1 - er, dN = er, dE = cols - 1 - ec, dW = ec;
          const minD = Math.min(dS, dN, dE, dW);
          if      (minD === dS) { doorWall = 'S'; doorPos = ec; }
          else if (minD === dN) { doorWall = 'N'; doorPos = ec; }
          else if (minD === dE) { doorWall = 'E'; doorPos = er; }
          else                  { doorWall = 'W'; doorPos = er; }
        }
        const splitH = (wallId, z, rot, along) => {
          if (doorWall === along) {
            const gapStart = Math.max(0, doorPos - Math.floor(DOOR_W / 2));
            const gapEnd   = Math.min(cols, gapStart + DOOR_W);
            if (gapStart > 0)    panels.push({ id: wallId + '_l', width: gapStart,        height: wallHeight, position: [gapStart / 2,            0, z], rotationDeg: rot });
            if (gapEnd < cols)   panels.push({ id: wallId + '_r', width: cols - gapEnd,   height: wallHeight, position: [(gapEnd + cols) / 2,     0, z], rotationDeg: rot });
          } else {
            panels.push({ id: wallId, width: cols, height: wallHeight, position: [cols / 2, 0, z], rotationDeg: rot });
          }
        };
        const splitV = (wallId, x, rot, along) => {
          if (doorWall === along) {
            const gapStart = Math.max(0, doorPos - Math.floor(DOOR_W / 2));
            const gapEnd   = Math.min(rows, gapStart + DOOR_W);
            if (gapStart > 0)    panels.push({ id: wallId + '_l', width: gapStart,        height: wallHeight, position: [x, 0, gapStart / 2],            rotationDeg: rot });
            if (gapEnd < rows)   panels.push({ id: wallId + '_r', width: rows - gapEnd,   height: wallHeight, position: [x, 0, (gapEnd + rows) / 2],     rotationDeg: rot });
          } else {
            panels.push({ id: wallId, width: rows, height: wallHeight, position: [x, 0, rows / 2], rotationDeg: rot });
          }
        };
        splitH('wn', 0,    [0, 0,    0], 'N');
        splitH('ws', rows, [0, 180,  0], 'S');
        splitV('ww', 0,    [0, 90,   0], 'W');
        splitV('we', cols, [0, -90,  0], 'E');
        return panels;
      }
      function buildWallPanelsFromFloorSet(floorSet, exitTileSet, wallHeight) {
        const nMap = {}, sMap = {}, eMap = {}, wMap = {};
        function pushH(map, key, x0, x1) { if (!map[key]) map[key] = []; map[key].push({ x0, x1 }); }
        function pushV(map, key, z0, z1) { if (!map[key]) map[key] = []; map[key].push({ z0, z1 }); }
        function mergeH(segs) {
          segs.sort((a, b) => a.x0 - b.x0);
          const out = [];
          for (const s of segs) {
            if (out.length && out[out.length - 1].x1 >= s.x0) out[out.length - 1].x1 = Math.max(out[out.length - 1].x1, s.x1);
            else out.push({ x0: s.x0, x1: s.x1 });
          }
          return out;
        }
        function mergeV(segs) {
          segs.sort((a, b) => a.z0 - b.z0);
          const out = [];
          for (const s of segs) {
            if (out.length && out[out.length - 1].z1 >= s.z0) out[out.length - 1].z1 = Math.max(out[out.length - 1].z1, s.z1);
            else out.push({ z0: s.z0, z1: s.z1 });
          }
          return out;
        }
        for (const key of floorSet) {
          const parts = key.split(',');
          const c = Number(parts[0]), r = Number(parts[1]);
          const isExit = exitTileSet.has(key);
          if (!floorSet.has(`${c},${r - 1}`) && !isExit) pushH(nMap, r,     c, c + 1);
          if (!floorSet.has(`${c},${r + 1}`) && !isExit) pushH(sMap, r + 1, c, c + 1);
          if (!floorSet.has(`${c + 1},${r}`) && !isExit) pushV(eMap, c + 1, r, r + 1);
          if (!floorSet.has(`${c - 1},${r}`) && !isExit) pushV(wMap, c,     r, r + 1);
        }
        const panels = [];
        let pid = 0;
        for (const [rStr, segs] of Object.entries(nMap)) {
          const z = Number(rStr);
          for (const seg of mergeH(segs)) {
            const w = seg.x1 - seg.x0, cx = (seg.x0 + seg.x1) / 2;
            panels.push({ id: `wn_${pid++}`, width: w, height: wallHeight, position: [cx, 0, z], rotationDeg: [0, 0, 0] });
          }
        }
        for (const [rStr, segs] of Object.entries(sMap)) {
          const z = Number(rStr);
          for (const seg of mergeH(segs)) {
            const w = seg.x1 - seg.x0, cx = (seg.x0 + seg.x1) / 2;
            panels.push({ id: `ws_${pid++}`, width: w, height: wallHeight, position: [cx, 0, z], rotationDeg: [0, 180, 0] });
          }
        }
        for (const [cStr, segs] of Object.entries(eMap)) {
          const x = Number(cStr);
          for (const seg of mergeV(segs)) {
            const d = seg.z1 - seg.z0, cz = (seg.z0 + seg.z1) / 2;
            panels.push({ id: `we_${pid++}`, width: d, height: wallHeight, position: [x, 0, cz], rotationDeg: [0, -90, 0] });
          }
        }
        for (const [cStr, segs] of Object.entries(wMap)) {
          const x = Number(cStr);
          for (const seg of mergeV(segs)) {
            const d = seg.z1 - seg.z0, cz = (seg.z0 + seg.z1) / 2;
            panels.push({ id: `ww_${pid++}`, width: d, height: wallHeight, position: [x, 0, cz], rotationDeg: [0, 90, 0] });
          }
        }
        return panels;
      }

      async function loadBuildingScene(mapId) {
        if (_buildingScenes.has(mapId) && _buildingScenes.get(mapId) !== null) return;
        _buildingScenes.set(mapId, null); // sentinel: loading in progress
        let mapData = null;
        let loadSource = 'missing';
        try {
          const resp = await fetch('config/maps/' + mapId + '.json');
          if (resp.ok) { mapData = await resp.json(); loadSource = 'config'; }
        } catch(_) {}
        // Fallback: load map data from cached workspace JSON
        if (!mapData && _workspaceMaps) {
          const wsMap = _workspaceMaps.find(m => m.id === mapId);
          if (wsMap) {
            const tileArr = [];
            for (const [key, val] of Object.entries(wsMap.tiles || {})) {
              const [c, r] = key.split(',').map(Number);
              if (Number.isFinite(c) && Number.isFinite(r)) tileArr.push({ c, r, type: val.type || 'grass' });
            }
            mapData = { cols: wsMap.cols, rows: wsMap.rows, tiles: tileArr, transitions: wsMap.transitions || [], npcStations: wsMap.npcStations || [] };
            loadSource = 'workspace';
            window.__farmLog?.(`[building] ${mapId}: loaded from workspace fallback (${mapData.cols}x${mapData.rows})`, 'warn');
          }
        }

        // ── hobunji_building_interior.v1 schema ──────────────────────────
        if (mapData?.schema === 'hobunji_building_interior.v1') {
          const cols = mapData.cols || 20, rows = mapData.rows || 20;
          const bGrid = Array.from({ length: rows }, () =>
            Array.from({ length: cols }, () => ({
              type: TileType.ROCK, water: 0, crop: CropType.NONE,
              cropAge: 0, cropReady: false, stress: '', variation: 0,
            }))
          );
          // Fill floor tiles as walkable
          const floorSet = new Set();
          for (const [c, r] of (mapData.floor || [])) {
            if (bGrid[r]?.[c]) { bGrid[r][c].type = TileType.GRASS; floorSet.add(`${c},${r}`); }
          }
          // Colliders override back to solid
          for (const [c, r] of (mapData.colliders || [])) {
            if (bGrid[r]?.[c]) bGrid[r][c].type = TileType.ROCK;
          }
          // Build transitions from exits array
          const transitions = [];
          const exitTileSet = new Set();
          for (const exit of (mapData.exits || [])) {
            const target = exit.targetMap ? 'building' : 'exit_building';
            for (const [tc, tr] of (exit.tiles || [])) {
              exitTileSet.add(`${tc},${tr}`);
              const t = { col: tc, row: tr, area: mapId, target, exitId: exit.id };
              if (exit.targetMap) { t.targetMapId = exit.targetMap; t.targetCol = exit.spawnCol || 0; t.targetRow = exit.spawnRow || 0; }
              transitions.push(t);
            }
          }
          // If workspace has a Map Editor version of this map, it is the source of truth
          // for game logic (spots/transitions, stations). The Interior Editor file above
          // only provided the visual layout (floor, furniture). Override now.
          const _wsOverride = _workspaceMaps?.find(m => m.id === mapId && m.schema !== 'hobunji_building_interior.v1');
          if (_wsOverride) {
            transitions.length = 0;
            exitTileSet.clear();
            for (const t of (_wsOverride.transitions || [])) {
              if (!Number.isFinite(t.col) || !Number.isFinite(t.row)) continue;
              const target = !t.targetMapId ? 'exit_building' : 'building';
              const tr = { col: t.col, row: t.row, area: mapId, target, exitId: t.exitId };
              if (t.targetMapId) { tr.targetMapId = t.targetMapId; tr.targetCol = t.spawnCol ?? 0; tr.targetRow = t.spawnRow ?? 0; }
              transitions.push(tr);
              if (!t.targetMapId) exitTileSet.add(`${t.col},${t.row}`);
            }
          }
          const bScene = new THREE.Scene();
          bScene.background = new THREE.Color(0x2a1a0a);
          bScene.add(new THREE.AmbientLight(0xfff5e0, 0.7));
          const dl = new THREE.DirectionalLight(0xffeedd, 0.5);
          dl.position.set(5, 10, 5);
          bScene.add(dl);
          const floorMat = new THREE.MeshLambertMaterial({ color: 0x8b6914 });
          new THREE.TextureLoader().load('assets/textures/boards.png', (tex) => {
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            floorMat.map = tex; floorMat.color.set(0xffffff); floorMat.needsUpdate = true;
          }, undefined, () => {});
          // Floor tiles only for defined floor set
          for (const [c, r] of (mapData.floor || [])) {
            const fl = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 1), floorMat);
            fl.position.set(c + 0.5, -0.05, r + 0.5);
            bScene.add(fl);
          }
          // Irregular brick walls with gaps at all exit tiles
          const wallPanels = buildWallPanelsFromFloorSet(floorSet, exitTileSet, INTERIOR_WALL_HEIGHT);
          if (wallPanels.length) {
            const wallGroup = houseWallBuilder.build(wallPanels, { usePlaceholder: false, unitMult: 0.5, rockScale: 1.5, preScale: [1, 1, 0.6], brickJitter: { rotYDeg: 8, shiftU: 0.04, shiftV: 0.03 } });
            _markOutline(wallGroup);
            bScene.add(wallGroup);
          }
          // Furniture: build combined itemKey -> def/furnitureKey lookup
          const allFurnDefs = {};
          const furnKeyByItemKey = {};
          for (const [key, def] of Object.entries(DECORATIVE_FURNITURE_DEFS)) { allFurnDefs[def.itemKey] = def; furnKeyByItemKey[def.itemKey] = key; }
          for (const [key, def] of Object.entries(PROCESSING_FURNITURE_DEFS)) { allFurnDefs[def.itemKey] = def; furnKeyByItemKey[def.itemKey] = key; }
          for (const f of (mapData.furniture || [])) {
            const def = allFurnDefs[f.itemKey];
            const furnitureKey = furnKeyByItemKey[f.itemKey];
            const color = def?.color || 0x888888;
            const scX = f.postSX != null ? f.postSX : (f.postScale != null ? f.postScale : 1);
            const scY = f.postSY != null ? f.postSY : (f.postScale != null ? f.postScale : 1);
            const scZ = f.postSZ != null ? f.postSZ : (f.postScale != null ? f.postScale : 1);
            const bx = (f.col + (def?.fw || 1) * 0.5) + (f.postX || 0);
            const by = f.postY || 0;
            const bz = (f.row + (def?.fd || 1) * 0.5) + (f.postZ || 0);
            const rotRad = THREE.MathUtils.degToRad(f.rotY || 0);
            if (furnitureKey && window.ProceduralFurniture.CATALOG[furnitureKey]) {
              const model = window.ProceduralFurniture.buildFurnitureGroup(furnitureKey, color);
              model.position.set(bx, by, bz);
              model.rotation.y = rotRad;
              model.scale.set(scX, scY, scZ);
              _markOutline(model);
              _markFurnitureEdgeId(model);
              bScene.add(model);
              registerFurnitureSfxSource(mapId, bx, bz, resolveFurnitureSfx(def));
            } else {
              // Fallback: no procedural recipe found for this furniture key
              window.__farmLog?.(`[furniture] ${furnitureKey || '(no key)'}: no procedural recipe → fallback placeholder box`, 'warn');
              const ph = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshLambertMaterial({ color }));
              ph.position.set(bx, by + 0.4, bz);
              ph.rotation.y = rotRad;
              ph.scale.set(scX, scY, scZ);
              _markOutline(ph);
              _markFurnitureEdgeId(ph);
              bScene.add(ph);
              registerFurnitureSfxSource(mapId, bx, bz, resolveFurnitureSfx(def));
            }
          }
          const _stationSrc = (_wsOverride?.npcStations?.length ? _wsOverride.npcStations : mapData.npcStations) || [];
          registerNpcStations(_stationSrc.map(st => ({ ...st, area: mapId })), mapId);
          const buildingPaths = (mapData.npcPaths || []).filter(p => p && Array.isArray(p.nodes) && p.nodes.length > 0)
            .map(p => ({ ...p, area: mapId }));
          const buildingRoutes = normalizeRoutes(
            (mapData.routes || []).map(r => ({ ...r, area: mapId })),
            buildingPaths);
          if (buildingRoutes.length) {
            worldRoutes = worldRoutes.filter(r => (r.area || 'farm') !== mapId).concat(buildingRoutes);
            rebuildRouteGraphs();
          }
          const info = { scene: bScene, grid: bGrid, cols, rows, transitions, vendorZones: mapData.vendorZones || [], routes: buildingRoutes, loadSource, fallback: loadSource !== 'config', name: mapData.name || mapId };
          _buildingScenes.set(mapId, info);
          for (const w of npcWalkers) {
            if (w.root._pendingBuildingAdd === mapId) {
              w.root._pendingBuildingAdd = null;
              bScene.add(w.root); w.root._npcScene = bScene;
            }
          }
          if (_currentBuildingMapId === mapId && _isBuildingArea(currentArea)) {
            bScene.add(playerMesh); bScene.add(playerGroundShadow);
            if (_pendingEntrySpawnFromExit) {
              _pendingEntrySpawnFromExit = false;
              const sp = buildingSpawnFromExit(info, cols, rows);
              player.x = (sp.col + 0.5) * TILE;
              player.y = (sp.row + 0.5) * TILE;
              _snapCameraTarget();
            }
          }
          debugLog('loadBuildingScene: ' + mapId + ' (' + cols + 'x' + rows + ') [v1]');
          return;
        }

        // ── Legacy rectangular-room schema ───────────────────────────────
        const cols = mapData?.cols || 20, rows = mapData?.rows || 20;
        const bGrid = Array.from({ length: rows }, () =>
          Array.from({ length: cols }, () => ({
            type: TileType.GRASS, water: 0, crop: CropType.NONE,
            cropAge: 0, cropReady: false, stress: '', variation: 0,
          }))
        );
        if (mapData) {
          for (const tile of (mapData.tiles || [])) {
            if (bGrid[tile.r]?.[tile.c]) bGrid[tile.r][tile.c].type = tile.type || TileType.GRASS;
          }
        }
        // Convert workspace exit transitions (targetMapId=town) to exit_building so checkTransitionSpots fires
        const transitions = (mapData?.transitions || [])
          .filter(t => Number.isFinite(t.col) && Number.isFinite(t.row))
          .map(t => ({ ...t, area: mapId, target: t.target || 'exit_building' }));
        const bScene = new THREE.Scene();
        bScene.background = new THREE.Color(0x2a1a0a);
        bScene.add(new THREE.AmbientLight(0xfff5e0, 0.7));
        const dl = new THREE.DirectionalLight(0xffeedd, 0.5);
        dl.position.set(5, 10, 5);
        bScene.add(dl);
        const floorMat = new THREE.MeshLambertMaterial({ color: 0x8b6914 });
        new THREE.TextureLoader().load('assets/textures/boards.png', (tex) => {
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          floorMat.map = tex; floorMat.color.set(0xffffff); floorMat.needsUpdate = true;
        }, undefined, () => {});
        // Floor covers the full footprint — walls always sit on the boundary
        for (let r2 = 0; r2 < rows; r2++) for (let c2 = 0; c2 < cols; c2++) {
          const fl = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 1), floorMat);
          fl.position.set(c2 + 0.5, -0.05, r2 + 0.5);
          bScene.add(fl);
        }
        // Brick walls at footprint boundary with a door gap at the exit transition
        const exitT = transitions.find(t => t.target === 'exit_building');
        const wallPanels = buildWallPanelsForRoom(cols, rows, INTERIOR_WALL_HEIGHT, exitT);
        if (wallPanels.length) {
          const wallGroup = houseWallBuilder.build(wallPanels, { usePlaceholder: false, unitMult: 0.5, rockScale: 1.5, preScale: [1, 1, 0.6], brickJitter: { rotYDeg: 8, shiftU: 0.04, shiftV: 0.03 } });
          _markOutline(wallGroup);
          bScene.add(wallGroup);
        }
        const info = { scene: bScene, grid: bGrid, cols, rows, transitions, loadSource, fallback: loadSource !== 'config', name: mapData?.name || mapId };
        _buildingScenes.set(mapId, info);
        for (const w of npcWalkers) {
          if (w.root._pendingBuildingAdd === mapId) {
            w.root._pendingBuildingAdd = null;
            bScene.add(w.root); w.root._npcScene = bScene;
          }
        }
        if (_currentBuildingMapId === mapId && _isBuildingArea(currentArea)) {
          bScene.add(playerMesh); bScene.add(playerGroundShadow);
        }
        debugLog('loadBuildingScene: ' + mapId + ' (' + cols + 'x' + rows + ')');
      }

      function buildingSpawnFromExit(bi, fallbackCols, fallbackRows) {
        const exitTiles = (bi?.transitions || []).filter(t => t.target === 'exit_building');
        if (!exitTiles.length) return { col: Math.floor(fallbackCols / 2), row: Math.max(0, fallbackRows - 2) };
        // Multiple unrelated exit_building tiles can exist on one map (e.g. a real
        // exterior door plus an unwired stairwell stub). Cluster tiles that share the
        // same exitId/door, then use the largest cluster so a stray single-tile stub
        // can't drag the computed spawn point away from the actual entrance.
        const clusters = new Map();
        for (const t of exitTiles) {
          const key = t.exitId != null ? t.exitId : `${t.col},${t.row}`;
          if (!clusters.has(key)) clusters.set(key, []);
          clusters.get(key).push(t);
        }
        let mainCluster = exitTiles;
        if (clusters.size > 1) {
          mainCluster = [...clusters.values()].reduce((a, b) => (b.length > a.length ? b : a));
        }
        const avgCol = mainCluster.reduce((sum, t) => sum + t.col, 0) / mainCluster.length;
        const northRow = Math.min(...mainCluster.map(t => t.row)) - 1;
        return {
          col: clamp(Math.round(avgCol), 0, fallbackCols - 1),
          row: clamp(northRow, 0, fallbackRows - 1)
        };
      }

      function mapDebugName(area) {
        if (area === 'interior') return 'Farmhouse Interior';
        if (area === 'town') return _townZone?.name || 'Hobunji Hollow — Town';
        if (area === 'farm') return 'Farm';
        if (_isBuildingArea(area)) return _buildingScenes.get(area)?.name || area;
        return area || '(unknown)';
      }

      function logMapSwap(label, area, extra = {}) {
        const source = extra.source || 'runtime';
        const fallback = !!extra.fallback;
        const loading = !!extra.loading;
        const target = extra.target ? ` target=${extra.target}` : '';
        window.__farmLog?.(`[map] ${label}: currentMap=${area} name="${mapDebugName(area)}" source=${source} fallback=${fallback}${loading ? ' loading=true' : ''}${target}`, fallback ? 'warn' : 'info');
      }

      function enterBuilding(mapId, defaultCol, defaultRow) {
        if (!_buildingScenes.has(mapId)) loadBuildingScene(mapId);
        const fromScene = _isBuildingArea(currentArea) ? (_buildingScenes.get(currentArea)?.scene || null)
          : currentArea === 'town' ? townScene : scene;
        if (!_isBuildingArea(currentArea)) {
          farmPlayerSave = { x: player.x, y: player.y, angle: player.angle, area: currentArea };
        }
        _currentBuildingMapId = mapId;
        currentArea = mapId;
        const bi = _buildingScenes.get(mapId);
        const bCols = bi?.cols || 20, bRows = bi?.rows || 20;
        // Default entry is one tile north of the building's exit. Explicit
        // inter-floor spawn coordinates still win when an exit supplies them.
        const exitSpawn = buildingSpawnFromExit(bi, bCols, bRows);
        const col = Number.isFinite(defaultCol) ? defaultCol : exitSpawn.col;
        const row = Number.isFinite(defaultRow) ? defaultRow : exitSpawn.row;
        // If the scene hasn't loaded yet (bi===null) and no explicit coords, defer
        // the spawn correction to when loadBuildingScene finishes.
        _pendingEntrySpawnFromExit = !bi && !Number.isFinite(defaultCol);
        player.x = (col + 0.5) * TILE; player.y = (row + 0.5) * TILE;
        player.vx = 0; player.vy = 0;
        facingAngle = Math.PI / 2; player.angle = facingAngle;
        _snapCameraTarget();
        if (fromScene) {
          fromScene.remove(playerMesh); fromScene.remove(playerGroundShadow);
          fromScene.remove(toolHolder); fromScene.remove(reticleMesh);
          fromScene.remove(reticleCircleMesh); fromScene.remove(reticleRingMesh);
          fromScene.remove(reticleWavyGroup);
        }
        if (bi?.scene) { bi.scene.add(playerMesh); bi.scene.add(playerGroundShadow); }
        refreshActionBar();
        logMapSwap('enterBuilding', currentArea, { source: bi?.loadSource || 'loading', fallback: bi?.fallback || !bi, loading: !bi });
      }

      function exitBuilding() {
        if (!_isBuildingArea(currentArea)) return;
        startSceneTransition(() => {
          const fromScene = _buildingScenes.get(currentArea)?.scene || null;
          const returnArea = farmPlayerSave?.area ?? 'town';
          if (fromScene) { fromScene.remove(playerMesh); fromScene.remove(playerGroundShadow); }
          _currentBuildingMapId = null;
          currentArea = returnArea;
          if (farmPlayerSave) {
            player.x = farmPlayerSave.x; player.y = farmPlayerSave.y;
            player.angle = farmPlayerSave.angle; facingAngle = farmPlayerSave.angle;
          }
          player.vx = 0; player.vy = 0;
          _snapCameraTarget();
          const toScene = returnArea === 'town' ? townScene : scene;
          if (toScene) {
            toScene.add(playerMesh); toScene.add(playerGroundShadow);
            toScene.add(toolHolder); toScene.add(reticleMesh);
            toScene.add(reticleCircleMesh); toScene.add(reticleRingMesh);
            toScene.add(reticleWavyGroup);
          }
          refreshActionBar();
          logMapSwap('exitBuilding', currentArea);
        });
      }

      // ── Exterior zones (Northern Cliffs / Southern Cloud Forest) ──────
      async function enterZone(mapId, defaultCol, defaultRow) {
        // A Tothal Shift in progress is about to replace this zone's layout —
        // wait for it so the player lands on the freshly reshaped map instead
        // of whatever was cached (or authored) a moment before the shift.
        if (_tothalShiftPromise) {
          showToast('The wilds are still settling into shape…', true);
          await _tothalShiftPromise;
        }
        const zdef = EXTERIOR_ZONES[mapId];
        if (!zdef && !_zoneLayouts.has(mapId)) return;
        const zi = buildZoneScene(mapId);
        if (!zi) return;
        const fromScene = getActiveScene();
        _currentBuildingMapId = null;
        currentArea = mapId;
        const col = Number.isFinite(defaultCol) ? defaultCol : (zdef?.entryCol ?? 0);
        const row = Number.isFinite(defaultRow) ? defaultRow : (zdef?.entryRow ?? 0);
        player.x = (col + 0.5) * TILE; player.y = (row + 0.5) * TILE;
        player.vx = 0; player.vy = 0;
        facingAngle = -Math.PI / 2; player.angle = facingAngle;
        _snapCameraTarget();
        if (fromScene) {
          fromScene.remove(playerMesh); fromScene.remove(playerGroundShadow);
          fromScene.remove(toolHolder); fromScene.remove(reticleMesh);
          fromScene.remove(reticleCircleMesh); fromScene.remove(reticleRingMesh);
          fromScene.remove(reticleWavyGroup);
        }
        zi.scene.add(playerMesh); zi.scene.add(playerGroundShadow);
        zi.scene.add(toolHolder); zi.scene.add(reticleMesh);
        zi.scene.add(reticleCircleMesh); zi.scene.add(reticleRingMesh);
        zi.scene.add(reticleWavyGroup);
        refreshActionBar();
        logMapSwap('enterZone', currentArea);
      }

      // ── Town building detection ──────────────────────────────────────
      // Reads explicit building entries from the town layout (placed by map editor).
      function _detectTownBuildings() {
        const buildings = _townZone?.buildings || [];
        debugLog('_detectTownBuildings: ' + buildings.length + ' placed buildings');
        return buildings;
      }

      // Spawns Highland house pieces for all placed town buildings.
      // Fetches each building's piece JSON then calls HousePieceGen.buildGroupFromPiece(),
      // which reads piece.base.faces directly (same geometry as the house editor preview)
      // plus WallBuilder bricks on wall/gable faces.
      let _townBuildingsGlbUpgradePending = false;
      // Each entry: { group, bldg, piece, wbOpts, wbGableOpts }
      function _spawnTownBuildings() {
        if (!townScene || !_townBuildingDefs.length) return;
        if (typeof HousePieceGen === 'undefined') {
          debugLog('HousePieceGen not loaded — skipping town buildings', 'warn');
          return;
        }

        // Dispose previous groups
        for (const entry of _townBuildingGroups) {
          townScene.remove(entry.group);
          entry.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
        }
        _townBuildingGroups = [];

        const _wbDefaults = { unitMult: 0.4375, rockScale: 1.5,
                              preScale: [1, 1, 0.6],
                              brickJitter: { rotYDeg: 8, shiftU: 0.04, shiftV: 0.03 } };

        // Preload boards.png for porch/stair/railing faces (shared across all buildings)
        const _boardsMat = new THREE.MeshLambertMaterial({ color: 0x8b6914, side: THREE.DoubleSide });
        new THREE.TextureLoader().load('assets/textures/boards.png', (tex) => {
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          _boardsMat.map = tex; _boardsMat.color.set(0xffffff); _boardsMat.needsUpdate = true;
        }, undefined, () => {});

        // Async-load all piece files in parallel, then build scene
        Promise.all(_townBuildingDefs.map(bldg => {
          if (!bldg.pieceFile) return Promise.resolve({ bldg, piece: null });
          return fetch(bldg.pieceFile)
            .then(r => r.json())
            .then(piece => ({ bldg, piece }))
            .catch(e => { debugLog('Piece load error (' + bldg.id + '): ' + e, 'warn'); return { bldg, piece: null }; });
        })).then(results => {
          if (!townScene) return;
          const TROWS_ENT = _townZone?.rows || 50;
          const _entranceRingGeo = new THREE.RingGeometry(0.22, 0.36, 24);
          const _entranceMat = new THREE.MeshBasicMaterial({ color: 0x7c3008, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false });

          for (const { bldg, piece } of results) {
            const wbOpts      = bldg.wbOpts      || _wbDefaults;
            const wbGableOpts = bldg.wbGableOpts || undefined;

            let g = new THREE.Group();
            if (piece) {
              g = HousePieceGen.buildGroupFromPiece(THREE, piece, bldg.gridX, bldg.gridZ, {
                wallBuilder: houseWallBuilder, wbUsePlaceholder: true,
                wbOpts, wbGableOpts, matBoards: _boardsMat,
                rotationDeg: bldg.rotationDeg || 0,
              });
            }
            townScene.add(g);
            _townBuildingGroups.push({ group: g, bldg, piece, wbOpts, wbGableOpts });

            // Entrance ring: compute position using rotation-aware porch/stair cells.
            // rotateBuildingCollisionCell is hoisted (function declaration at line ~3490).
            const rotDeg = bldg.rotationDeg || bldg.rotation || 0;
            const allBldgCells = []
              .concat(piece?.footprint?.cells || [])
              .concat(piece?.footprint?.extensions?.entryTunnels || [])
              .concat(piece?.footprint?.extensions?.chimneys || [])
              .concat(piece?.footprint?.extensions?.porches || [])
              .concat(piece?.footprint?.extensions?.porchStairs || [])
              .concat(piece?.footprint?.extensions?.railings || []);
            const gc = Math.floor((piece?.gridSize || 18) / 2);
            const bldgMinX = allBldgCells.length ? Math.min.apply(null, allBldgCells.map(c => c.x)) : gc - 3;
            const bldgMinY = allBldgCells.length ? Math.min.apply(null, allBldgCells.map(c => c.y)) : gc - 3;
            const bldgMaxX = allBldgCells.length ? Math.max.apply(null, allBldgCells.map(c => c.x)) : gc + 3;
            const bldgMaxY = allBldgCells.length ? Math.max.apply(null, allBldgCells.map(c => c.y)) : gc + 3;
            const bboxW = bldgMaxX - bldgMinX + 1;
            const bboxD = bldgMaxY - bldgMinY + 1;
            // Rotate all cells to get the world-space bounding box (for hasWorkspaceEntry)
            let wBMinC = Infinity, wBMaxC = -Infinity, wBMinR = Infinity, wBMaxR = -Infinity;
            for (const cell of allBldgCells) {
              const r = rotateBuildingCollisionCell(cell.x - bldgMinX, cell.y - bldgMinY, bboxW, bboxD, rotDeg);
              const wc = bldg.gridX + r.x, wr = bldg.gridZ + r.y;
              if (wc < wBMinC) wBMinC = wc; if (wc > wBMaxC) wBMaxC = wc;
              if (wr < wBMinR) wBMinR = wr; if (wr > wBMaxR) wBMaxR = wr;
            }
            const hasBldgCells = allBldgCells.length > 0;
            // Porch + stair cells (non-colliding) determine where the entrance ring sits
            const psCells = []
              .concat(piece?.footprint?.extensions?.porches || [])
              .concat(piece?.footprint?.extensions?.porchStairs || []);
            let eCol, eRow;
            if (psCells.length && hasBldgCells) {
              let wPMinC = Infinity, wPMaxC = -Infinity, wPMinR = Infinity, wPMaxR = -Infinity;
              for (const cell of psCells) {
                const r = rotateBuildingCollisionCell(cell.x - bldgMinX, cell.y - bldgMinY, bboxW, bboxD, rotDeg);
                const wc = bldg.gridX + r.x, wr = bldg.gridZ + r.y;
                if (wc < wPMinC) wPMinC = wc; if (wc > wPMaxC) wPMaxC = wc;
                if (wr < wPMinR) wPMinR = wr; if (wr > wPMaxR) wPMaxR = wr;
              }
              eCol = Math.floor((wPMinC + wPMaxC + 1) / 2);
              // Use the porch row closest to the structural body (not outer stairs)
              const bldgCentroidR = (wBMinR + wBMaxR) / 2;
              const innerPorchR = Math.abs(wPMinR - bldgCentroidR) <= Math.abs(wPMaxR - bldgCentroidR) ? wPMinR : wPMaxR;
              eRow = Math.min(TROWS_ENT - 1, innerPorchR);
            } else {
              // No porch data: south edge of rotated bounding box
              eCol = hasBldgCells ? Math.floor((wBMinC + wBMaxC + 1) / 2) : Math.floor((bldg.gridX * 2 + (bldg.footprintW ?? 1) + 1) / 2);
              eRow = hasBldgCells ? Math.min(TROWS_ENT - 1, wBMaxR + 1) : Math.min(TROWS_ENT - 1, bldg.gridZ + (bldg.footprintD ?? 1));
            }
            const eid = 'bldg_entrance_' + bldg.id;
            // Skip auto-entrance if workspace already defined a building transition within the rotated footprint
            const hasWorkspaceEntry = worldTownTransitions.some(t =>
              t.target === 'building' &&
              Number.isFinite(t.col) && Number.isFinite(t.row) &&
              t.col >= wBMinC && t.col <= wBMaxC &&
              t.row >= wBMinR && t.row <= wBMaxR);
            const hasAnyEntryAtDoor = worldTownTransitions.some(t => Number.isFinite(t.col) && Number.isFinite(t.row) && t.col === eCol && t.row === eRow);
            if (!hasWorkspaceEntry && !hasAnyEntryAtDoor && !worldTownTransitions.find(t => t.id === eid)) {
              worldTownTransitions.push({
                id: eid, area: 'town', col: eCol, row: eRow,
                target: 'interior',
                targetCol: Math.floor(INTERIOR_COLS / 2), targetRow: INTERIOR_ROWS - 2,
              });
              const ring = new THREE.Mesh(_entranceRingGeo, _entranceMat);
              ring.rotation.x = -Math.PI / 2;
              ring.position.set(eCol + 0.5, tileSurfaceY(TileType.GRASS) + 0.02, eRow + 0.5);
              townScene.add(ring);
            }
          }

          debugLog('_spawnTownBuildings: built ' + _townBuildingGroups.length + ' buildings from piece JSON');

          // Upgrade to real bricks + shingle GLB once assets are ready
          if (!_townBuildingsGlbUpgradePending) {
            _townBuildingsGlbUpgradePending = true;
            Promise.all([
              houseWallBuilder.loadDefaultGlb(),
              HousePieceGen.loadShingleGlb('assets/models/'),
            ]).then(() => {
              _townBuildingsGlbUpgradePending = false;
              if (!townScene) return;
              debugLog('Town buildings: upgrading to real bricks + shingle GLB');
              const prev = _townBuildingGroups.slice();
              _townBuildingGroups = [];
              for (const { group, bldg, piece, wbOpts, wbGableOpts } of prev) {
                townScene.remove(group);
                group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
                if (!piece) continue;
                const g = HousePieceGen.buildGroupFromPiece(THREE, piece, bldg.gridX, bldg.gridZ, {
                  wallBuilder: houseWallBuilder, wbUsePlaceholder: false,
                  wbOpts, wbGableOpts, matBoards: _boardsMat,
                  rotationDeg: bldg.rotationDeg || 0,
                });
                townScene.add(g);
                _townBuildingGroups.push({ group: g, bldg, piece, wbOpts, wbGableOpts });
              }
            }).catch(e => debugLog('Town building GLB error: ' + e, 'warn'));
          }
        });
      }

      // Mirrors _spawnTownBuildings for an exterior zone map (Northern Cliffs,
      // its plateau-tier sub-maps, etc.) — buildings placed there get the same
      // piece-JSON geometry, but lifted to their anchor tile's plateau tier
      // (zoneData.buildings[].elevTier, resolved in the mergeZoneTiles loop
      // above) via HousePieceGen's elevationY option, instead of always
      // sitting at world Y 0 the way town buildings do today.
      let _zoneBuildingsGlbUpgradePending = new Set();
      function _spawnZoneBuildings(mapId) {
        const zoneData = _zoneLayouts.get(mapId);
        const buildingDefs = zoneData?.buildings || [];
        if (!buildingDefs.length) return;
        if (typeof HousePieceGen === 'undefined') {
          debugLog('HousePieceGen not loaded — skipping zone buildings', 'warn');
          return;
        }
        if (_zoneBuildingGroups.has(mapId)) return; // already spawned for this zone scene

        const groups = [];
        _zoneBuildingGroups.set(mapId, groups);

        const _wbDefaults = { unitMult: 0.4375, rockScale: 1.5,
                              preScale: [1, 1, 0.6],
                              brickJitter: { rotYDeg: 8, shiftU: 0.04, shiftV: 0.03 } };
        const _boardsMat = new THREE.MeshLambertMaterial({ color: 0x8b6914, side: THREE.DoubleSide });
        new THREE.TextureLoader().load('assets/textures/boards.png', (tex) => {
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          _boardsMat.map = tex; _boardsMat.color.set(0xffffff); _boardsMat.needsUpdate = true;
        }, undefined, () => {});

        Promise.all(buildingDefs.map(bldg => {
          if (!bldg.pieceFile) return Promise.resolve({ bldg, piece: null });
          return fetch(bldg.pieceFile)
            .then(r => r.json())
            .then(piece => ({ bldg, piece }))
            .catch(e => { debugLog('Zone piece load error (' + bldg.id + '): ' + e, 'warn'); return { bldg, piece: null }; });
        })).then(results => {
          const scene = _zoneScenes.get(mapId)?.scene;
          if (!scene) return;

          for (const { bldg, piece } of results) {
            const wbOpts      = bldg.wbOpts      || _wbDefaults;
            const wbGableOpts = bldg.wbGableOpts || undefined;
            const elevationY  = NORMAL_TOP + (bldg.elevTier || 0) * PLATEAU_UNIT;

            let g = new THREE.Group();
            if (piece) {
              g = HousePieceGen.buildGroupFromPiece(THREE, piece, bldg.gridX, bldg.gridZ, {
                wallBuilder: houseWallBuilder, wbUsePlaceholder: true,
                wbOpts, wbGableOpts, matBoards: _boardsMat,
                rotationDeg: bldg.rotationDeg || 0, elevationY,
              });
            }
            scene.add(g);
            groups.push({ group: g, bldg, piece, wbOpts, wbGableOpts });
          }

          debugLog(`_spawnZoneBuildings(${mapId}): built ${groups.length} buildings from piece JSON`);

          if (!_zoneBuildingsGlbUpgradePending.has(mapId)) {
            _zoneBuildingsGlbUpgradePending.add(mapId);
            Promise.all([
              houseWallBuilder.loadDefaultGlb(),
              HousePieceGen.loadShingleGlb('assets/models/'),
            ]).then(() => {
              _zoneBuildingsGlbUpgradePending.delete(mapId);
              const scene2 = _zoneScenes.get(mapId)?.scene;
              if (!scene2) return;
              debugLog(`Zone buildings (${mapId}): upgrading to real bricks + shingle GLB`);
              const prev = groups.slice();
              groups.length = 0;
              for (const { group, bldg, piece, wbOpts, wbGableOpts } of prev) {
                scene2.remove(group);
                group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
                if (!piece) continue;
                const elevationY = NORMAL_TOP + (bldg.elevTier || 0) * PLATEAU_UNIT;
                const g = HousePieceGen.buildGroupFromPiece(THREE, piece, bldg.gridX, bldg.gridZ, {
                  wallBuilder: houseWallBuilder, wbUsePlaceholder: false,
                  wbOpts, wbGableOpts, matBoards: _boardsMat,
                  rotationDeg: bldg.rotationDeg || 0, elevationY,
                });
                scene2.add(g);
                groups.push({ group: g, bldg, piece, wbOpts, wbGableOpts });
              }
            }).catch(e => debugLog('Zone building GLB error: ' + e, 'warn'));
          }
        });
      }

      function _spawnZoneDecorFurniture(mapId) {
        const zoneData = _zoneLayouts.get(mapId);
        const decorDefs = zoneData?.decor || [];
        const furnitureDefs = zoneData?.furniture || [];
        if (!decorDefs.length && !furnitureDefs.length) return;
        if (typeof window.ProceduralFurniture === 'undefined') {
          debugLog('ProceduralFurniture not loaded — skipping zone decor/furniture', 'warn');
          return;
        }
        if (_zoneDecorFurnitureGroups.has(mapId)) return; // already spawned for this zone scene
        const scene = _zoneScenes.get(mapId)?.scene;
        if (!scene) return;

        const meshes = [];
        _zoneDecorFurnitureGroups.set(mapId, meshes);

        for (const d of decorDefs) {
          const result = makeDecorativeFurnitureMesh(d.col, d.row, d.key, scene, mapId);
          if (!result) continue;
          const y = NORMAL_TOP + (d.elevTier || 0) * PLATEAU_UNIT;
          result.mesh.position.y += y;
          if (result.light) result.light.position.y += y;
          meshes.push(result.mesh);
        }
        for (const f of furnitureDefs) {
          const def = PROCESSING_FURNITURE_DEFS[f.key];
          if (!def) continue;
          const group = window.ProceduralFurniture.buildFurnitureGroup(f.key, def.color || 0x888888);
          const y = NORMAL_TOP + (f.elevTier || 0) * PLATEAU_UNIT;
          group.position.set(f.col + 0.5, y, f.row + 0.5);
          _markOutline(group);
          _markFurnitureEdgeId(group);
          scene.add(group);
          meshes.push(group);
          registerFurnitureSfxSource(mapId, f.col + 0.5, f.row + 0.5, resolveFurnitureSfx(def));
        }
        debugLog(`_spawnZoneDecorFurniture(${mapId}): built ${decorDefs.length} decor + ${furnitureDefs.length} furniture props`);
      }

      // Tears down a previously built zone scene so buildZoneScene(mapId)'s
      // cache check falls through and rebuilds it from whatever's now in
      // _zoneLayouts — used by a Tothal Shift to apply newly generated
      // wilderness terrain. Only disposes geometries; tileMats/houseWallBuilder
      // materials are shared across every map and must outlive this.
      function _disposeZoneScene(mapId) {
        const zi = _zoneScenes.get(mapId);
        if (zi?.scene) zi.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
        _zoneScenes.delete(mapId);
        _zoneWaterMeshes.delete(mapId);
        const buildingGroups = _zoneBuildingGroups.get(mapId);
        if (buildingGroups) for (const { group } of buildingGroups) group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
        _zoneBuildingGroups.delete(mapId);
        const decorFurniture = _zoneDecorFurnitureGroups.get(mapId);
        if (decorFurniture) for (const obj of decorFurniture) obj.traverse?.(o => { if (o.geometry) o.geometry.dispose(); });
        _zoneDecorFurnitureGroups.delete(mapId);
        _zoneBuildingsGlbUpgradePending.delete(mapId);
        for (const source of _furnitureSfxSources.filter(s => s.area === mapId)) unregisterFurnitureSfxSource(source);
      }

      function buildTownScene() {
        if (_townSceneBuilt) return;
        _townSceneBuilt = true;

        townScene = new THREE.Scene();
        townScene.background = new THREE.Color(0x7da87b);
        townScene.fog = new THREE.FogExp2(0x7da87b, 0.018); // match farm fog density
        townAmbientLight = new THREE.AmbientLight(0xfff0e0, 0.7);
        townScene.add(townAmbientLight);
        townSunLight = new THREE.DirectionalLight(0xffeedd, 1.1);
        townSunLight.position.set(4, 8, 2);
        townScene.add(townSunLight);

        const TCOLS = _townZone?.cols || 60, TROWS = _townZone?.rows || 50;

        // Ground: real per-vertex seam-safe heightfield geometry, same pipeline
        // as the farm (makeFloorGeo / buildPathTileGeo / buildTerrainTileGeo —
        // all keyed on a hash of absolute world coords so adjacent tiles' shared
        // edge vertices match exactly, with no gaps or independently-tilted
        // facets). Per-tile geometries are merged into one BufferGeometry per
        // material so the whole town ground still costs only a handful of draw
        // calls despite TCOLS*TROWS individual tiles.
        const _floorBuckets = new Map();
        const _addToBucket = (matKey, geo, x, y, z) => {
          if (!geo) return;
          let arr = _floorBuckets.get(matKey);
          if (!arr) { arr = []; _floorBuckets.set(matKey, arr); }
          arr.push({ geo, x, y, z });
        };

        // Paths are no longer flat per-tile slabs stitched at the edges — the
        // whole road network builds as one continuous heightfield (see
        // buildPathNetworkGeo) so the dirt/grass boundary reads as an organic
        // line independent of the tile grid. Tiles inside its bounding box
        // are skipped below (pathNet.inBounds) except for TRENCH/RAISED/
        // SHRUB/ROCK, which keep their own geometry.
        const pathNet = buildPathNetworkGeo(townGrid, TCOLS, TROWS);
        if (pathNet) {
          _addToBucket(TileType.PATH,  pathNet.pathGeo,  0, NORMAL_TOP, 0);
          _addToBucket(TileType.GRASS, pathNet.grassGeo, 0, NORMAL_TOP, 0);
        }

        const riverTiles = [];

        for (let r = 0; r < TROWS; r++) for (let c = 0; c < TCOLS; c++) {
          const tile = townGrid[r]?.[c];
          const tp = (tile?.type === TileType.ROCK) ? TileType.GRASS : (tile?.type || TileType.GRASS);
          const cx = c + 0.5, cz = r + 0.5;

          if (tp === TileType.TRENCH || tp === TileType.RAISED || tp === TileType.RIVER || tp === TileType.STREAM) {
            const { dirtGeo, grassGeo } = buildTerrainTileGeo(c, r, tp, townGrid);
            const bedMatKey = (tp === TileType.RIVER || tp === TileType.STREAM) ? tp : TileType.TRENCH;
            _addToBucket(bedMatKey, dirtGeo, cx, NORMAL_TOP, cz);
            _addToBucket(TileType.GRASS, grassGeo, cx, NORMAL_TOP, cz);
            if (tp === TileType.RIVER || tp === TileType.STREAM) riverTiles.push({ c, r, tp });
            continue;
          }
          if (tile?.type !== TileType.ROCK && (tp === TileType.PATH ||
              (pathNet && pathNet.inBounds(c, r) && !pathNet.isExcludedTile(c, r) && tp === TileType.GRASS))) {
            continue; // covered by the path network mesh above
          }
          if (tp === TileType.SHRUB) {
            _addToBucket(TileType.GRASS, makeFloorGeo(c, r), cx, tileYCenter(TileType.GRASS), cz);
            if (window.FoliageGenerator) {
              const vegGroup = window.FoliageGenerator.buildShrubMesh(c, r);
              vegGroup.scale.set(2, 2, 2);
              vegGroup.position.set(cx, tileSurfaceY(TileType.GRASS), cz);
              townScene.add(vegGroup);
              _markOutline(vegGroup);
            }
            continue;
          }
          // GRASS / TILLED / any other flat type — subdivided slab
          const matKey = tileMats[tp] ? tp : TileType.GRASS;
          _addToBucket(matKey, makeFloorGeo(c, r), cx, tileYCenter(tp), cz);
        }

        for (const [matKey, entries] of _floorBuckets) {
          const merged = _mergeTileGeos(entries);
          const mesh = new THREE.Mesh(merged, tileMats[matKey] || tileMats.grass);
          mesh.receiveShadow = true;
          townScene.add(mesh);
          _markTerrainEdgeId(mesh, _terrainCategoryFor(matKey));
        }

        // River/stream water surface — an animated translucent plane sitting
        // above the sunken bed built above, so the banks read as real depth
        // instead of a flat colored tile. Flow direction comes from which
        // neighbouring tiles are also water, so the shader's flow-stripe mode
        // animates along the channel rather than rippling in place.
        const isWaterTile = (cc, rr) => {
          const t = townGrid[rr]?.[cc]?.type;
          return t === TileType.RIVER || t === TileType.STREAM;
        };
        _townRiverWaterMeshes = riverTiles.map(({ c, r, tp }) => {
          let fx = (isWaterTile(c + 1, r) ? 1 : 0) - (isWaterTile(c - 1, r) ? 1 : 0);
          let fz = (isWaterTile(c, r + 1) ? 1 : 0) - (isWaterTile(c, r - 1) ? 1 : 0);
          const flen = Math.hypot(fx, fz);
          if (flen > 0.001) { fx /= flen; fz /= flen; } else { fx = 0; fz = 0; }
          const deep = tp === TileType.RIVER;
          const mat = new THREE.ShaderMaterial({
            uniforms: {
              uTime:  { value: 0 },
              uPhase: { value: (c * 2.7 + r * 4.1) % 6.28 },
              uDepth: { value: deep ? 0.8 : 0.45 },
              uFlow:  { value: new THREE.Vector2(fx, fz) },
              uColor: { value: new THREE.Color(deep ? 0x1f6f9c : 0x4fb8d9) },
            },
            vertexShader:   waterVertShader,
            fragmentShader: waterFragShader,
            transparent:    true,
            depthWrite:     false,
            side:           THREE.FrontSide,
          });
          const wm = new THREE.Mesh(waterGeo, mat);
          wm.receiveShadow = false;
          wm.position.set(c + 0.5, NORMAL_TOP - (deep ? 0.10 : 0.05), r + 0.5);
          townScene.add(wm);
          _markTerrainEdgeId(wm, 'water');
          return wm;
        });

        _buildTownGrassBillboards(TCOLS, TROWS);
        buildTownBorderTerrain();

        // Gold ring markers for town transitions
        const ringGeo = new THREE.RingGeometry(0.22, 0.36, 24);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
        for (const t of worldTownTransitions) {
          const tile = townGrid[t.row]?.[t.col];
          const ring = new THREE.Mesh(ringGeo, ringMat);
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(t.col + 0.5, tileSurfaceY((tile?.type) || TileType.GRASS) + 0.02, t.row + 0.5);
          townScene.add(ring);
        }

        // Add any NPC walkers that were spawned before town scene was built
        for (const w of npcWalkers) {
          if (w.root._pendingTownAdd) {
            w.root._pendingTownAdd = false;
            townScene.add(w.root);
            w.root._npcScene = townScene;
          }
          if (w.root._pendingBuildingAdd === undefined) w.root._pendingBuildingAdd = null;
        }

        // Generate 3D buildings from rock-tile clusters
        _townBuildingDefs = _detectTownBuildings();
        _spawnTownBuildings();

        debugLog('buildTownScene complete');
      }

      function enterTown(col, row) {
        const fromScene = getActiveScene();
        buildTownScene();
        farmPlayerSave = { x: player.x, y: player.y, angle: player.angle };
        _currentBuildingMapId = null;
        currentArea = 'town';
        player.x = (col + 0.5) * TILE;
        player.y = (row + 0.5) * TILE;
        player.vx = 0; player.vy = 0;
        facingAngle = -Math.PI / 2;
        player.angle = facingAngle;
        _snapCameraTarget();
        if (fromScene) {
          fromScene.remove(playerMesh);
          fromScene.remove(playerGroundShadow);
          fromScene.remove(toolHolder);
          fromScene.remove(reticleMesh);
          fromScene.remove(reticleCircleMesh);
          fromScene.remove(reticleRingMesh);
          fromScene.remove(reticleWavyGroup);
        }
        if (townScene) {
          townScene.add(playerMesh);
          townScene.add(playerGroundShadow);
          townScene.add(toolHolder);
          townScene.add(reticleMesh);
          townScene.add(reticleCircleMesh);
          townScene.add(reticleRingMesh);
          townScene.add(reticleWavyGroup);
        }
        refreshActionBar();
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
        // Doorstep tiles — one row north of the door, also trigger entrance
        const _doorstep = {
          id: 'house_entrance', type: 'house_entrance',
          getButtons() { return [{ icon: '🚪', label: 'Enter', action: 'obj_enter_house', style: 'primary', allowed: true }]; },
          onAction(action) {
            if (action === 'obj_enter_house') {
              startSceneTransition(() => enterInterior());
              return { ok: true, message: 'Entering the Highland House…' };
            }
            return { ok: false, message: 'Unknown house action.' };
          },
        };
        worldObjects.set(DOOR_COL + ',' + (DOOR_ROW - 1), _doorstep);
        worldObjects.set((DOOR_COL + 1) + ',' + (DOOR_ROW - 1), _doorstep);
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
        sceneTransFromArea = currentArea;
      }

      function updateSceneTransition(dt) {
        if (sceneTransDir === 0) return;
        if (sceneTransDir === 1) {
          sceneTransAlpha = Math.min(1, sceneTransAlpha + dt * 4);
          if (sceneTransAlpha >= 1 && sceneTransCb) {
            const _cb = sceneTransCb;
            sceneTransCb  = null;
            sceneTransDir = -1;
            const fromArea = sceneTransFromArea;
            try {
              _cb();
              if (fromArea && fromArea !== currentArea) catchNpcsOnPlayerAreaTransition(fromArea, currentArea);
            } catch(e) { debugLog('scene transition error: ' + (e?.stack || e), 'error'); }
          }
        } else {
          // Hold the black overlay until the building scene has finished loading
          // so the player never briefly sees the farm scene on entry.
          if (_isBuildingArea(currentArea) && _buildingScenes.has(currentArea) && !_buildingScenes.get(currentArea)) {
            return;
          }
          sceneTransAlpha = Math.max(0, sceneTransAlpha - dt * 2.5);
          if (sceneTransAlpha <= 0) sceneTransDir = 0;
        }
      }

      // ── Enter / exit the interior ─────────────────────────────────
      function enterInterior() {
        buildInteriorScene();  // no-op after first call
        const fromScene = currentArea === 'town' ? townScene : scene;
        farmPlayerSave = { x: player.x, y: player.y, angle: player.angle, area: currentArea };
        currentArea    = 'interior';
        player.x       = (INTERIOR_ENTRY_COL + 0.5) * TILE;
        player.y       = (INTERIOR_ENTRY_ROW + 0.5) * TILE;
        player.vx      = 0;  player.vy = 0;
        facingAngle    = Math.PI / 2;   // face south (into the room)
        player.angle   = facingAngle;
        _snapCameraTarget();
        // Move player mesh into interior scene
        fromScene.remove(playerMesh);
        fromScene.remove(playerGroundShadow);
        fromScene.remove(toolHolder);
        fromScene.remove(reticleMesh);
        fromScene.remove(reticleCircleMesh);
        fromScene.remove(reticleRingMesh);
        fromScene.remove(reticleWavyGroup);
        clearTargetHighlights();
        interiorScene.add(playerMesh);
        interiorScene.add(playerGroundShadow);
        refreshActionBar();
      }

      function exitInterior() {
        if (currentArea !== 'interior') return;
        startSceneTransition(() => {
          const returnArea = farmPlayerSave?.area ?? 'farm';
          currentArea = returnArea;
          if (farmPlayerSave) {
            player.x     = farmPlayerSave.x;
            player.y     = farmPlayerSave.y;
            player.angle = farmPlayerSave.angle;
            facingAngle  = farmPlayerSave.angle;
          }
          player.vx  = 0;  player.vy = 0;
          _snapCameraTarget();
          // Move player mesh back to the scene they came from
          const toScene = returnArea === 'town' ? townScene : scene;
          interiorScene.remove(playerMesh);
          interiorScene.remove(playerGroundShadow);
          toScene.add(playerMesh);
          toScene.add(playerGroundShadow);
          toScene.add(toolHolder);
          toScene.add(reticleMesh);
          toScene.add(reticleCircleMesh);
          toScene.add(reticleRingMesh);
          toScene.add(reticleWavyGroup);
          refreshActionBar();
        });
      }

      function getWorldObjectAt(col, row) {
        const corpse = getCorpseObjectAt(col, row);
        if (corpse) return corpse;
        if (currentArea === 'interior') return interiorWorldObjects.get(col + ',' + row) || null;
        if (currentArea !== 'farm') return null;
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
      let generalStoreActiveCategory = 'goods'; // Mirrors supply-shop tabs for the General Store's goods/clothing split.

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
        document.querySelectorAll('[data-supply-cat]').forEach(btn => {
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
            if (result.ok !== false) saveMemberWorldData();
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

      // ── General Store page render ───────────────────────────────────
      function getGeneralStoreCategoryLabel(category) {
        return ({ all: 'All', goods: 'Goods', clothing: 'Clothing' })[category] || 'General Store';
      }

      function bindGeneralStoreTabs() {
        document.querySelectorAll('.general-store-tab').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.generalStoreCat === generalStoreActiveCategory);
          btn.onclick = () => {
            generalStoreActiveCategory = btn.dataset.generalStoreCat || 'goods';
            renderGeneralStorePage();
          };
        });
      }

      function buyGeneralStoreItem(item) {
        const gold = inventory.gold || 0;
        if (gold < item.price) { showToast('Not enough gold.', false); return; }
        inventory.gold = gold - item.price;
        if (item.gives) {
          Object.entries(item.gives).forEach(([k, v]) => {
            inventory[k] = Math.min(99, (inventory[k] || 0) + v);
          });
        }
        showToast('Bought ' + item.name + '!', true);
        renderGeneralStorePage();
        buildInventoryGrid();
        saveMemberWorldData();
      }

      function renderGeneralStoreGoods(list) {
        GENERAL_STORE_CATALOG.forEach(item => {
          const row = document.createElement('div');
          row.className = 'shop-row';
          row.innerHTML = `
            <div class="sh-icon">${item.icon}</div>
            <div class="sh-info">
              <div class="sh-name">${item.name}</div>
              <div class="sh-desc">${item.desc}</div>
              <div class="sh-price">${item.price}g each</div>
            </div>
            <button class="shop-buy-btn" data-key="${item.key}">Buy</button>
          `;
          row.querySelector('[data-key]')?.addEventListener('click', () => buyGeneralStoreItem(item));
          list.appendChild(row);
        });
      }

      function renderGeneralStoreClothing(list) {
        const clothHdrEl = document.createElement('div');
        clothHdrEl.className = 'shop-section-label';
        clothHdrEl.textContent = '🧥 Today\'s Clothing  (rerolls each day)';
        list.appendChild(clothHdrEl);

        generateDailyClothingStock(calendar.day).forEach(item => {
          const row = document.createElement('div');
          row.className = 'shop-row';
          row.innerHTML = `
            <div class="sh-icon">👘</div>
            <div class="sh-info">
              <div class="sh-name">${esc(item.label)}</div>
              <div class="sh-desc">${item.slot.charAt(0).toUpperCase() + item.slot.slice(1)} — goes to pack inventory</div>
              <div class="sh-price">${item.price}g each</div>
            </div>
            <button class="shop-buy-btn gs-cloth-buy">Buy</button>
          `;
          row.querySelector('.gs-cloth-buy')?.addEventListener('click', () => {
            if ((inventory.gold || 0) < item.price) { showToast('Not enough gold.', false); return; }
            inventory.gold = (inventory.gold || 0) - item.price;
            packClothing.push({ ...item });
            showToast('Bought ' + item.label + '!', true);
            renderGeneralStorePage(); buildInventoryGrid(); buildPackClothingSection();
            saveMemberWorldData();
          });
          list.appendChild(row);
        });
      }

      function renderGeneralStorePage() {
        bindGeneralStoreTabs();
        const sectionTitle = document.getElementById('generalStoreSectionTitle');
        if (sectionTitle) sectionTitle.textContent = 'Funji & Son\'s General Store — ' + getGeneralStoreCategoryLabel(generalStoreActiveCategory);
        const list   = document.getElementById('generalStoreList');
        const goldEl = document.getElementById('gsGoldDisplay');
        if (goldEl) goldEl.innerHTML = `${inventory.gold || 0}<span class="wallet-unit">g</span>`;
        if (!list) return;
        list.innerHTML = '';
        if (generalStoreActiveCategory === 'goods' || generalStoreActiveCategory === 'all') renderGeneralStoreGoods(list);
        if (generalStoreActiveCategory === 'clothing' || generalStoreActiveCategory === 'all') renderGeneralStoreClothing(list);
      }

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
        { key: 'garWolfMeat',        icon: '🥩', label: 'GAR-WOLF MEAT',    max: 99 },
        { key: 'garWolfHide',        icon: '🟫', label: 'GAR-WOLF HIDE',    max: 99 },
        { key: 'alphaGarWolfMeat',   icon: '🥩', label: 'ALPHA GAR-WOLF MEAT', max: 99 },
        { key: 'alphaGarWolfHide',   icon: '🟫', label: 'ALPHA GAR-WOLF HIDE', max: 99 },
        { key: 'dabinggiHoundMeat',  icon: '🥩', label: 'DABINGGI-HOUND MEAT', max: 99 },
        { key: 'dabinggiHoundHide',  icon: '🟫', label: 'DABINGGI-HOUND HIDE', max: 99 },
        { key: 'uumkaoiiCrate',      icon: '🦆', label: 'UUMKAO\'II CRATE',  max: 9  },
        { key: 'bronzehoe',    icon: '🪓', label: 'BRONZE HOE',    max: 9 },
        { key: 'hatchet',      icon: '🪓', label: 'HATCHET',       max: 9 },
        { key: 'fishingmace',  icon: '🎣', label: 'FISHING MACE',  max: 9 },
        { key: 'fishingspear', icon: '🎣', label: 'FISHING SPEAR', max: 9 },
        { key: 'pickshovel',   icon: '⛏️', label: 'PICK-SHOVEL',   max: 9 },
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
        garWolfMeat: { icon: '🥩', label: 'Gar-wolf Meat', cat: 'material', sellPrice: 9, tags: ['Material', 'Meat'], desc: 'Raw meat butchered from a slain gar-wolf. Good for cooking or smoking.' },
        garWolfHide: { icon: '🟫', label: 'Gar-wolf Hide', cat: 'material', sellPrice: 14, tags: ['Material', 'Hide'], desc: 'A tough hide stripped from a slain gar-wolf.' },
        alphaGarWolfMeat: { icon: '🥩', label: 'Alpha Gar-wolf Meat', cat: 'material', sellPrice: 16, tags: ['Material', 'Meat'], desc: 'Prime meat butchered from a slain alpha gar-wolf.' },
        alphaGarWolfHide: { icon: '🟫', label: 'Alpha Gar-wolf Hide', cat: 'material', sellPrice: 26, tags: ['Material', 'Hide'], desc: 'A thick, battle-scarred hide stripped from a slain alpha gar-wolf.' },
        dabinggiHoundMeat: { icon: '🥩', label: 'Dabinggi-hound Meat', cat: 'material', sellPrice: 8, tags: ['Material', 'Meat'], desc: 'Raw meat butchered from a fallen dabinggi-hound.' },
        dabinggiHoundHide: { icon: '🟫', label: 'Dabinggi-hound Hide', cat: 'material', sellPrice: 12, tags: ['Material', 'Hide'], desc: 'A soft hide stripped from a fallen dabinggi-hound.' },
        uumkaoiiCrate: { icon: '🦆', label: 'Uumkao\'ii Crate', cat: 'livestock', sellPrice: 0, tags: ['Livestock', 'Crate'], desc: 'Select this in your bag and use it while targeting an open tile to release the uumkao\'ii.' },
        bronzehoe:    { icon: '🪓', label: 'Bronze Hoe',    cat: 'tool', sellPrice: 0, tags: ['Tool', 'Hoe'],     desc: 'A sturdy bronze hoe for tilling and smoothing soil.' },
        hatchet:      { icon: '🪓', label: 'Hatchet',       cat: 'tool', sellPrice: 0, tags: ['Tool', 'Axe', 'Weapon'],             desc: 'A sharp hatchet. Fits in the axe or weapon slot.' },
        fishingmace:  { icon: '🎣', label: 'Fishing Mace',  cat: 'tool', sellPrice: 0, tags: ['Tool', 'Harpoon', 'Weapon'],         desc: 'A weighted fishing mace for spearfishing. Fits in the harpoon or weapon slot.' },
        fishingspear: { icon: '🎣', label: 'Fishing Spear', cat: 'tool', sellPrice: 0, tags: ['Tool', 'Harpoon', 'Weapon'],         desc: 'A slender fishing spear. Fits in the harpoon or weapon slot.' },
        pickshovel:   { icon: '⛏️', label: 'Pick-Shovel',   cat: 'tool', sellPrice: 0, tags: ['Tool', 'Shovel', 'Pick', 'Weapon'],  desc: 'A combination pick-shovel for digging. Fits in the shovel, pick, or weapon slot.' },
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

      Object.values(DECORATIVE_FURNITURE_DEFS).forEach(def => {
        if (!inventoryItems.some(item => item.key === def.itemKey)) {
          inventoryItems.push({ key: def.itemKey, icon: def.icon, label: def.name.toUpperCase(), max: 99 });
        }
        if (!ITEM_DEFS[def.itemKey]) {
          ITEM_DEFS[def.itemKey] = {
            icon: def.icon, label: def.name, cat: 'furniture', sellPrice: 0,
            tags: ['Furniture', 'Decorative', def.area || 'interior'], desc: def.desc
          };
        }
      });

      // ── Fish catalog ────────────────────────────────────────────
      // Keyed by zone category. "town" is the only zone with real river/stream
      // tiles today; northernCliffs/cloudForest are existing map IDs that have
      // no water bodies yet, and westernSlope/easternMire aren't built as zones
      // at all — all three are kept here so the catalog is ready the moment
      // those areas grow water. `seasons`/`timesOfDay` are 'any' or a subset of
      // the `seasons` array's `.name` values / ['dawn','day','dusk','night'].
      const FISH_DEFS = {
        farm: [
          { key: 'fish_riverMinnow',     label: 'River Minnow',     icon: '🐟', rarity: 'common',   sellPrice: 6,  seasons: 'any', timesOfDay: 'any',            fishClass: 'smooth',  difficulty: 28 },
          { key: 'fish_speckledCarp',    label: 'Speckled Carp',    icon: '🐠', rarity: 'common',   sellPrice: 9,  seasons: 'any', timesOfDay: ['day', 'dusk'],   fishClass: 'sinker',  difficulty: 35 },
        ],
        town: [
          { key: 'fish_riverMinnow',     label: 'River Minnow',     icon: '🐟', rarity: 'common',   sellPrice: 6,  seasons: 'any', timesOfDay: 'any',            fishClass: 'smooth',  difficulty: 28 },
          { key: 'fish_speckledCarp',    label: 'Speckled Carp',    icon: '🐠', rarity: 'common',   sellPrice: 9,  seasons: 'any', timesOfDay: ['day', 'dusk'],   fishClass: 'sinker',  difficulty: 35 },
          { key: 'fish_bronzefinTrout',  label: 'Bronzefin Trout',  icon: '🐡', rarity: 'uncommon', sellPrice: 22, seasons: ['Early Dry', 'Late Dry'],          timesOfDay: ['dawn', 'dusk'],  fishClass: 'dart',    difficulty: 52 },
          { key: 'fish_mossbackCatfish', label: 'Mossback Catfish', icon: '🐟', rarity: 'uncommon', sellPrice: 24, seasons: ['First Rains', 'Wet Peak'],        timesOfDay: ['night'],         fishClass: 'floater', difficulty: 48 },
          { key: 'fish_goldenKoi',       label: 'Golden Koi',       icon: '🐠', rarity: 'rare',     sellPrice: 60, seasons: 'any', timesOfDay: ['dawn'],          fishClass: 'mixed',   difficulty: 70 },
        ],
        northernCliffs: [
          { key: 'fish_cliffsideChar',   label: 'Cliffside Char',   icon: '🐟', rarity: 'common',   sellPrice: 10, seasons: ['Early Dry', 'Late Dry'],          timesOfDay: 'any',             fishClass: 'dart',    difficulty: 38 },
          { key: 'fish_stonebellyTrout', label: 'Stonebelly Trout', icon: '🐠', rarity: 'common',   sellPrice: 11, seasons: 'any', timesOfDay: ['day'],           fishClass: 'sinker',  difficulty: 34 },
          { key: 'fish_frostWhiskerEel', label: 'Frost Whisker Eel',icon: '🐡', rarity: 'uncommon', sellPrice: 26, seasons: ['First Rains', 'Wet Peak'],        timesOfDay: ['night'],         fishClass: 'smooth',  difficulty: 50 },
          { key: 'fish_cliffHawkSalmon', label: 'Cliff Hawk Salmon',icon: '🐠', rarity: 'rare',     sellPrice: 65, seasons: ['Wet Peak'],                       timesOfDay: ['dawn', 'dusk'],  fishClass: 'dart',    difficulty: 72 },
          { key: 'fish_ironscalePike',   label: 'Ironscale Pike',   icon: '🐟', rarity: 'rare',     sellPrice: 58, seasons: 'any', timesOfDay: ['night'],         fishClass: 'mixed',   difficulty: 68 },
        ],
        cloudForest: [
          { key: 'fish_cloudmistGuppy',  label: 'Cloudmist Guppy',  icon: '🐠', rarity: 'common',   sellPrice: 7,  seasons: 'any', timesOfDay: ['dawn', 'dusk'],  fishClass: 'floater', difficulty: 26 },
          { key: 'fish_fernshadeLoach',  label: 'Fernshade Loach',  icon: '🐟', rarity: 'common',   sellPrice: 9,  seasons: ['First Rains', 'Wet Peak'],        timesOfDay: 'any',             fishClass: 'smooth',  difficulty: 30 },
          { key: 'fish_orchidBetta',     label: 'Orchid Betta',     icon: '🐡', rarity: 'uncommon', sellPrice: 28, seasons: ['Wet Peak'],                       timesOfDay: ['day'],           fishClass: 'mixed',   difficulty: 46 },
          { key: 'fish_vinehookGar',     label: 'Vinehook Gar',     icon: '🐟', rarity: 'uncommon', sellPrice: 25, seasons: 'any', timesOfDay: ['night'],         fishClass: 'dart',    difficulty: 49 },
          { key: 'fish_canopyKoi',       label: 'Canopy Koi',       icon: '🐠', rarity: 'rare',     sellPrice: 62, seasons: ['First Rains'],                    timesOfDay: ['dawn'],          fishClass: 'floater', difficulty: 71 },
        ],
        westernSlope: [
          { key: 'fish_glacierSmelt',    label: 'Glacier Smelt',    icon: '🐟', rarity: 'common',   sellPrice: 8,  seasons: ['Early Dry', 'Late Dry'],          timesOfDay: 'any',             fishClass: 'smooth',  difficulty: 30 },
          { key: 'fish_frostbellyGrayling', label: 'Frostbelly Grayling', icon: '🐠', rarity: 'common', sellPrice: 10, seasons: 'any', timesOfDay: ['day'],     fishClass: 'dart',    difficulty: 37 },
          { key: 'fish_iceveilWhitefish',label: 'Iceveil Whitefish',icon: '🐡', rarity: 'uncommon', sellPrice: 27, seasons: ['Late Dry', 'First Rains'],        timesOfDay: ['dusk', 'night'], fishClass: 'sinker',  difficulty: 51 },
          { key: 'fish_snowmeltSalmon',  label: 'Snowmelt Salmon',  icon: '🐠', rarity: 'uncommon', sellPrice: 30, seasons: ['First Rains'],                    timesOfDay: ['dawn'],          fishClass: 'dart',    difficulty: 55 },
          { key: 'fish_glassfinChar',    label: 'Glassfin Char',    icon: '🐟', rarity: 'rare',     sellPrice: 64, seasons: ['Wet Peak'],                       timesOfDay: ['night'],         fishClass: 'mixed',   difficulty: 73 },
          { key: 'fish_permafrostEel',   label: 'Permafrost Eel',   icon: '🐡', rarity: 'rare',     sellPrice: 59, seasons: ['Early Dry'],                      timesOfDay: ['night'],         fishClass: 'floater', difficulty: 69 },
        ],
        easternMire: [
          { key: 'fish_mudskipper',      label: 'Mudskipper',       icon: '🐟', rarity: 'common',   sellPrice: 6,  seasons: 'any', timesOfDay: ['day'],           fishClass: 'sinker',  difficulty: 27 },
          { key: 'fish_swampBullhead',   label: 'Swamp Bullhead',   icon: '🐠', rarity: 'common',   sellPrice: 9,  seasons: 'any', timesOfDay: ['dusk', 'night'], fishClass: 'floater', difficulty: 33 },
          { key: 'fish_mireleafTetra',   label: 'Mireleaf Tetra',   icon: '🐡', rarity: 'uncommon', sellPrice: 23, seasons: ['Wet Peak', 'First Rains'],        timesOfDay: 'any',             fishClass: 'smooth',  difficulty: 45 },
          { key: 'fish_bogLamprey',      label: 'Bog Lamprey',      icon: '🐟', rarity: 'uncommon', sellPrice: 24, seasons: 'any', timesOfDay: ['night'],         fishClass: 'dart',    difficulty: 50 },
          { key: 'fish_murkwaterGar',    label: 'Murkwater Gar',    icon: '🐠', rarity: 'rare',     sellPrice: 61, seasons: ['Wet Peak'],                       timesOfDay: ['night'],         fishClass: 'mixed',   difficulty: 70 },
          { key: 'fish_willOWispEel',    label: "Will-o'-Wisp Eel", icon: '🐡', rarity: 'rare',     sellPrice: 66, seasons: ['First Rains'],                    timesOfDay: ['night'],         fishClass: 'floater', difficulty: 74 },
        ],
      };
      const FISH_ZONE_LABELS = {
        farm: 'Farm Pond', town: 'Town River', northernCliffs: 'Northern Cliffs', cloudForest: 'Southern Cloud Forest',
        westernSlope: 'Western Slope', easternMire: 'Eastern Mire',
      };

      Object.entries(FISH_DEFS).forEach(([zoneKey, list]) => {
        list.forEach(fish => {
          if (!inventoryItems.some(item => item.key === fish.key)) {
            inventoryItems.push({ key: fish.key, icon: fish.icon, label: fish.label.toUpperCase(), max: 99 });
          }
          if (!ITEM_DEFS[fish.key]) {
            ITEM_DEFS[fish.key] = {
              icon: fish.icon, label: fish.label, cat: 'material', sellPrice: fish.sellPrice,
              tags: ['Fish', fish.rarity, FISH_ZONE_LABELS[zoneKey]],
              desc: `A ${fish.rarity} fish speared in the ${FISH_ZONE_LABELS[zoneKey]}.`,
            };
          }
        });
      });

      function itemIconForKey(key) {
        return ITEM_DEFS[key]?.icon || SUPPLY_CATALOG.find(item => item.key === key)?.icon || '□';
      }

      // ── Inventory panel state ──────────────────────────────────────
      let invSelectedKey = null;
      let invActiveCat   = 'all';
      const INVENTORY_EMPTY_SLOT_FLOOR = 28; // Used by buildInventoryGrid() so the bag reads as open generic storage.

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
          // Taking items back OUT of storage is owner/granted-farmhand only —
          // depositing into it is always allowed.
          if (!hasFarmPermission('storage')) {
            showToast("Only the farm's owner (or a granted farmhand) can take from storage.", false);
            return;
          }
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
        saveMemberWorldData();
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

        const _slotAbbr = { hoe:'H', shovel:'Sh', axe:'Ax', pick:'Pk', harpoon:'Hp', weapon:'W' };
        keys.forEach(key => {
          const def   = ITEM_DEFS[key];
          const count = inventory[key] || 0;
          const box   = document.createElement('button');
          box.className = 'inv-item-box' + (key === invSelectedKey ? ' selected' : '');
          box.dataset.key = key;
          box.innerHTML =
            `<span class="iib-icon">${def.icon}</span>` +
            `<span class="iib-count">×${count}</span>`;
          // Corner badge listing every slot this item is assigned to
          const badges = Object.entries(equipmentSlots)
            .filter(([, v]) => v === key)
            .map(([s]) => _slotAbbr[s] || s.charAt(0).toUpperCase());
          if (badges.length) {
            const badge = document.createElement('span');
            badge.className = 'iib-equip-badge';
            badge.textContent = badges.join('·');
            box.appendChild(badge);
          }
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
        buildPackClothingSection();
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
              saveMemberWorldData();
            });
            mkBtn(`Sell 1  (${def.sellPrice}g)`, 'sell', () => {
              if ((inventory[key] || 0) < 1) return;
              inventory[key]--; inventory.gold = (inventory.gold || 0) + def.sellPrice;
              clampInventoryStack(key);
              showToast(`Sold 1 ${def.label} for ${def.sellPrice}g`, true);
              if (spGold) spGold.textContent = '💰 ' + inventory.gold + 'g';
              buildInventoryGrid(); refreshItemScroll(); refreshActionBar();
              saveMemberWorldData();
            });
          }
          // Tool items in pack: offer Transfer to Gear (can't equip directly from pack)
          const toolDef = TOOL_ITEM_DEFS[key];
          if (toolDef && count > 0) {
            if (!gearInventory?.tools?.[key]) {
              mkBtn('Transfer to Gear', 'equip', () => transferToolToGear(key));
            } else {
              mkBtn('Already in Gear (extra copy)', '', () => showToast('You already have this tool in your gear.', false));
            }
          }

          mkBtn('Drop  (coming soon)', '', () => showToast('Dropping items — coming soon', false));
        }
      }

      // Assign a tool item to a slot (tool must be in gear inventory)
      function equipItem(itemKey, slot) {
        const toolDef = TOOL_ITEM_DEFS[itemKey];
        if (!toolDef || !toolDef.slots.includes(slot)) { showToast('Cannot assign that item to that slot.', false); return; }
        if (!gearInventory?.tools?.[itemKey]) { showToast((TOOL_ITEM_DEFS[itemKey]?.label || itemKey) + ' is not in your gear. Transfer it first.', false); return; }
        equipmentSlots[slot] = itemKey;
        rebuildToolMeshes();
        Object.values(toolMeshMap).forEach(m => { if (m) toolHolder.remove(m); });
        if (toolMeshMap[activeTool]) toolHolder.add(toolMeshMap[activeTool]);
        showToast(`${toolDef.label} assigned as ${slot}.`, true);
        refreshActionBar();
      }

      // Clear a slot assignment (tool remains in gear inventory)
      function unequipItem(slot) {
        const itemKey = equipmentSlots[slot];
        if (!itemKey) return;
        equipmentSlots[slot] = null;
        rebuildToolMeshes();
        Object.values(toolMeshMap).forEach(m => { if (m) toolHolder.remove(m); });
        if (toolMeshMap[activeTool]) toolHolder.add(toolMeshMap[activeTool]);
        showToast(`${TOOL_ITEM_DEFS[itemKey]?.label || itemKey} unassigned from ${slot}.`, true);
        buildInventoryGrid();
        buildEquipmentSlots();
        refreshActionBar();
      }

      function transferToolToGear(itemKey) {
        const toolDef = TOOL_ITEM_DEFS[itemKey];
        if (!toolDef) return;
        if (gearInventory.tools[itemKey]) { showToast(toolDef.label + ' is already in your gear.', false); return; }
        if ((inventory[itemKey] || 0) < 1) { showToast('No ' + toolDef.label + ' in pack.', false); return; }
        inventory[itemKey]--;
        clampInventoryStack(itemKey);
        gearInventory.tools[itemKey] = true;
        saveGearInventory();
        showToast(toolDef.label + ' transferred to gear!', true);
        buildInventoryGrid(); buildEquipmentSlots(); clearInventoryDetail();
      }


      function makeClothingGearEntry(item) {
        if (!item) return null;
        return {
          uid: item.uid || 'gcloth_' + Math.random().toString(36).slice(2, 10),
          cosmeticId: item.cosmeticId,
          slot: item.slot,
          label: item.label,
          colorA: item.colorA,
          colorB: item.colorB,
          sprite: item.sprite || clothingSpriteForCosmetic(item.cosmeticId),
          sellPrice: item.sellPrice || 0,
        };
      }

      function clothingTintKeysForSlot(slot) {
        if (slot === 'hat') return ['HAT'];
        if (slot === 'hood') return ['HOOD', 'HOOD_B'];
        if (slot === 'torso') return ['TORSO'];
        if (slot === 'overwear') return ['CLOTH', 'CLOTH_B'];
        return [];
      }

      function applyGearClothingToPlayerData(playerData) {
        const equipped = Object.values(gearInventory?.clothing || {}).filter(Boolean);
        const equippedCosmetics = new Set(Array.isArray(playerData?.equippedCosmetics) ? playerData.equippedCosmetics : []);
        const bodyColors = { ...(playerData?.appearance?.bodyColors || {}) };
        for (const item of equipped) {
          if (item.cosmeticId) equippedCosmetics.add(item.cosmeticId);
          const [primaryTintKey, secondaryTintKey] = clothingTintKeysForSlot(item.slot);
          if (primaryTintKey && item.colorA) bodyColors[primaryTintKey] = { ...item.colorA };
          if (secondaryTintKey && item.colorB) bodyColors[secondaryTintKey] = { ...item.colorB };
        }
        return {
          ...playerData,
          equippedCosmetics: [...equippedCosmetics],
          appearance: {
            ...(playerData?.appearance || {}),
            bodyColors,
          },
        };
      }

      function disposeAvatarGroup(group) {
        group?.traverse?.(node => {
          node.geometry?.dispose?.();
          if (node.material) {
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            materials.forEach(mat => {
              mat.map?.dispose?.();
              mat.dispose?.();
            });
          }
        });
      }

      function removePlayerAvatarChildren() {
        playerMesh.children
          .filter(child => child?.name === 'player_avatar')
          .forEach(child => {
            playerMesh.remove(child);
            disposeAvatarGroup(child);
          });
      }

      async function refreshPlayerAvatar() {
        if (!_playerData || !window.NpcAvatarPreview || !window.PNGPlaneAvatar) return;
        const refreshGeneration = ++playerAvatarRefreshGeneration;
        removePlayerAvatarChildren();
        const profile = window.NpcAvatarPreview.buildProfileFromNpcExport(applyGearClothingToPlayerData(_playerData));
        if (!profile || refreshGeneration !== playerAvatarRefreshGeneration) return;
        const avatarCfg = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar || {};
        const MODEL_W = avatarCfg.worldModelWidth ?? 0.9;
        const PORTRAIT_SIZE = avatarCfg.previewPortraitCanvasSize ?? 200;
        const frontCanvas = document.createElement('canvas');
        frontCanvas.width = frontCanvas.height = PORTRAIT_SIZE;
        await window.NpcAvatarPreview.renderProfileToCanvas(frontCanvas, profile);
        if (refreshGeneration !== playerAvatarRefreshGeneration) return;
        const backCanvas = document.createElement('canvas');
        backCanvas.width = backCanvas.height = PORTRAIT_SIZE;
        await window.NpcAvatarPreview.renderProfileToCanvas(backCanvas, profile, { portraitView: 'behind' });
        if (refreshGeneration !== playerAvatarRefreshGeneration) return;
        const avatarGroup = window.PNGPlaneAvatar.buildSinglePlaneAvatarModel(
          THREE, frontCanvas,
          { backCanvas, profile, modelWidth: MODEL_W, modelHeight: MODEL_W, anchorZ: 0, alphaTest: avatarCfg.worldAlphaTest ?? 0.01 }
        );
        avatarGroup.name = 'player_avatar';
        const avatarHeight = avatarGroup.userData?.portraitModelHeight || MODEL_W;
        const avatarWidth = avatarGroup.userData?.portraitModelWidth || MODEL_W;
        avatarGroup.position.set(0, avatarHeight / 2, 0);
        // Tools/weapons hang from the avatar's actual scanned right-arm sprite edge
        // and bottom-edge pixel row (see handAttachX/handAttachY in
        // png-plane-avatar.js) — recompute here since this is the only place the
        // per-species scale/sprite is known.
        if (avatarGroup.userData?.handAttachX == null || avatarGroup.userData?.handAttachY == null) {
          window.__farmLog?.('[avatar] hand-attach scan failed → fallback to half-width/half-height tool base', 'warn');
        }
        playerToolBaseX = avatarGroup.userData?.handAttachX ?? (-avatarWidth / 2);
        playerToolBaseY = avatarGroup.userData?.handAttachY ?? (avatarHeight / 2);
        _markPngPlane(avatarGroup);
        if (refreshGeneration !== playerAvatarRefreshGeneration) {
          disposeAvatarGroup(avatarGroup);
          return;
        }
        removePlayerAvatarChildren();
        playerMesh.add(avatarGroup);
      }

      function clothingSpriteForCosmetic(cosmeticId) {
        return window.SCRATCHBONES_CONFIG?.game?.inventory?.clothingSprites?.[cosmeticId] || null;
      }

      function renderClothingIcon(parent, item, className = 'ies-cloth-sprite') {
        const sprite = item?.sprite || clothingSpriteForCosmetic(item?.cosmeticId);
        if (sprite) {
          const img = document.createElement('img');
          img.src = sprite;
          img.className = className;
          img.alt = item?.label || 'Clothing';
          parent.appendChild(img);
          return img;
        }
        const icon = document.createElement('span');
        icon.className = className + ' ies-cloth-fallback';
        icon.textContent = '👘';
        parent.appendChild(icon);
        return icon;
      }

      function setInventoryDetailClothingIcon(item) {
        const iconEl = document.getElementById('iiIcon');
        if (!iconEl) return;
        const sprite = item?.sprite || clothingSpriteForCosmetic(item?.cosmeticId);
        if (sprite) {
          iconEl.innerHTML = '<img class="ii-cloth-sprite" src="' + esc(sprite) + '" alt="' + esc(item?.label || 'Clothing') + '">';
        } else {
          iconEl.textContent = '👘';
        }
      }

      function ensureGearClothingCollection() {
        if (!gearInventory) return;
        if (!gearInventory.clothing) gearInventory.clothing = { hat: null, hood: null, torso: null, overwear: null };
        if (!Array.isArray(gearInventory.clothingItems)) gearInventory.clothingItems = [];
        for (const slot of ['hat', 'hood', 'torso', 'overwear']) {
          const worn = gearInventory.clothing[slot];
          if (!worn) continue;
          const wornEntry = makeClothingGearEntry({ ...worn, slot });
          if (!worn.uid) gearInventory.clothing[slot] = wornEntry;
          const hasItem = gearInventory.clothingItems.some(item => item.uid === wornEntry.uid);
          if (!hasItem) gearInventory.clothingItems.push(wornEntry);
        }
      }

      function transferClothingToGear(uid) {
        const idx = packClothing.findIndex(c => c.uid === uid);
        if (idx < 0) return;
        const item = makeClothingGearEntry(packClothing[idx]);
        ensureGearClothingCollection();
        gearInventory.clothingItems.push(item);
        gearInventory.clothing[item.slot] = item;
        packClothing.splice(idx, 1);
        saveGearInventory();
        saveMemberWorldData(); // packClothing (world-scoped) lost the item saveGearInventory just persisted to gear
        refreshPlayerAvatar();
        showToast(item.label + ' moved to gear and equipped!', true);
        buildPackClothingSection(); buildEquipmentSlots(); clearInventoryDetail();
      }

      function selectGearTool(key) {
        const def = TOOL_ITEM_DEFS[key];
        if (!def) return;
        invSelectedKey = null;
        document.querySelectorAll('.inv-item-box').forEach(b => b.classList.remove('selected'));
        const emptyEl  = document.getElementById('iiEmpty');
        const detailEl = document.getElementById('iiDetail');
        if (emptyEl)  emptyEl.style.display  = 'none';
        if (detailEl) detailEl.style.display  = '';
        const set = (id, val) => { const el = document.getElementById(id); if (el) el[typeof val === 'string' ? 'textContent' : 'innerHTML'] = val; };
        set('iiIcon',  def.icon);
        set('iiName',  def.label + ' (Gear)');
        set('iiPrice', 'Permanent — not sellable');
        set('iiTags',  def.slots.map(t => '<span class="ii-tag">' + t + '</span>').join(''));
        set('iiDesc',  'This tool is in your gear inventory. Assign it to an equipment slot to use it.');
        const actEl = document.getElementById('iiActions');
        if (actEl) {
          actEl.innerHTML = '';
          const mkBtn = (label, cls, fn) => {
            const b = document.createElement('button'); b.className = 'ii-btn' + (cls ? ' ' + cls : ''); b.textContent = label; b.onclick = fn; actEl.appendChild(b);
          };
          for (const slot of def.slots) {
            const isAssigned = equipmentSlots[slot] === key;
            mkBtn(isAssigned ? 'Unassign from ' + slot : 'Assign as ' + slot, 'equip', () => {
              if (isAssigned) unequipItem(slot); else equipItem(key, slot);
              buildEquipmentSlots(); selectGearTool(key);
            });
          }
        }
      }

      function selectPackClothingItem(uid) {
        const item = packClothing.find(c => c.uid === uid);
        if (!item) return;
        invSelectedKey = null;
        document.querySelectorAll('.inv-item-box').forEach(b => b.classList.remove('selected'));
        const emptyEl  = document.getElementById('iiEmpty');
        const detailEl = document.getElementById('iiDetail');
        if (emptyEl)  emptyEl.style.display  = 'none';
        if (detailEl) detailEl.style.display  = '';
        const set = (id, val) => { const el = document.getElementById(id); if (el) el[typeof val === 'string' ? 'textContent' : 'innerHTML'] = val; };
        setInventoryDetailClothingIcon(item);
        set('iiName',  item.label);
        set('iiPrice', item.sellPrice ? item.sellPrice + 'g' : '');
        set('iiTags',  '<span class="ii-tag">Clothing</span><span class="ii-tag">' + item.slot.charAt(0).toUpperCase() + item.slot.slice(1) + '</span>');
        set('iiDesc',  'Transfer to gear to wear it (permanent). Can sell while in pack.');
        const actEl = document.getElementById('iiActions');
        if (actEl) {
          actEl.innerHTML = '';
          const mkBtn = (label, cls, fn) => {
            const b = document.createElement('button'); b.className = 'ii-btn' + (cls ? ' ' + cls : ''); b.textContent = label; b.onclick = fn; actEl.appendChild(b);
          };
          mkBtn('Transfer to Gear (permanent)', 'equip', () => transferClothingToGear(uid));
          if (item.sellPrice > 0) {
            mkBtn('Sell (' + item.sellPrice + 'g)', 'sell', () => {
              packClothing = packClothing.filter(c => c.uid !== uid);
              inventory.gold = (inventory.gold || 0) + item.sellPrice;
              showToast('Sold ' + item.label + ' for ' + item.sellPrice + 'g', true);
              buildPackClothingSection(); buildInventoryGrid(); clearInventoryDetail();
              saveMemberWorldData();
            });
          }
        }
      }

      function equipGearClothing(uid) {
        ensureGearClothingCollection();
        const item = gearInventory.clothingItems.find(c => c.uid === uid);
        if (!item) return;
        gearInventory.clothing[item.slot] = item;
        saveGearInventory();
        refreshPlayerAvatar();
        showToast(item.label + ' equipped!', true);
        buildEquipmentSlots();
        selectGearClothing(item.slot, item);
      }

      function selectGearClothing(slot, item) {
        invSelectedKey = null;
        document.querySelectorAll('.inv-item-box').forEach(b => b.classList.remove('selected'));
        const emptyEl  = document.getElementById('iiEmpty');
        const detailEl = document.getElementById('iiDetail');
        if (emptyEl)  emptyEl.style.display  = 'none';
        if (detailEl) detailEl.style.display  = '';
        const set = (id, val) => { const el = document.getElementById(id); if (el) el[typeof val === 'string' ? 'textContent' : 'innerHTML'] = val; };
        setInventoryDetailClothingIcon(item);
        set('iiName',  item.label);
        set('iiPrice', 'Permanent gear — not sellable');
        set('iiTags',  '<span class="ii-tag">Clothing</span><span class="ii-tag">' + slot.charAt(0).toUpperCase() + slot.slice(1) + '</span>');
        const isWorn = gearInventory?.clothing?.[slot]?.uid === item.uid;
        set('iiDesc',  isWorn ? 'Currently worn. Select another collected piece below to swap.' : 'Collected clothing in gear. Equip it to wear it.');
        const actEl = document.getElementById('iiActions');
        if (actEl) {
          actEl.innerHTML = '';
          if (!isWorn) {
            const equipBtn = document.createElement('button');
            equipBtn.className = 'ii-btn equip';
            equipBtn.textContent = 'Equip';
            equipBtn.onclick = () => equipGearClothing(item.uid);
            actEl.appendChild(equipBtn);
          } else {
            const btn = document.createElement('button');
            btn.className = 'ii-btn';
            btn.textContent = 'De-equip';
            btn.onclick = () => {
              gearInventory.clothing[slot] = null;
              saveGearInventory();
              refreshPlayerAvatar();
              buildEquipmentSlots();
              clearInventoryDetail();
            };
            actEl.appendChild(btn);
          }
        }
      }

      function buildPackClothingSection() {
        const sec = document.getElementById('invPackClothing');
        if (!sec) return;
        if (!packClothing.length) {
          sec.innerHTML = '<div class="inv-pcloth-empty">No clothing in pack.</div>';
          return;
        }
        sec.innerHTML = '';
        packClothing.forEach(item => {
          const btn = document.createElement('button');
          btn.className = 'inv-pcloth-item';
          renderClothingIcon(btn, item, 'ipc-sprite');
          const name = document.createElement('span');
          name.className = 'ipc-name';
          name.textContent = item.label;
          btn.appendChild(name);
          btn.addEventListener('click', () => selectPackClothingItem(item.uid));
          sec.appendChild(btn);
        });
      }

      // Build the equipment slots panel inside #invEquipSection
      function buildEquipmentSlots() {
        const sec = document.getElementById('invEquipSection');
        if (!sec) return;
        sec.innerHTML = '';

        // ── Tool Slot Assignments ─────────────────────────────
        const slotHdr = document.createElement('div');
        slotHdr.className = 'inv-equip-label';
        slotHdr.textContent = 'Tool Slots';
        sec.appendChild(slotHdr);

        const toolRow = document.createElement('div');
        toolRow.className = 'inv-equip-row';
        const TOOL_SLOTS = ['hoe', 'shovel', 'axe', 'pick', 'harpoon', 'weapon'];
        for (const slot of TOOL_SLOTS) {
          const itemKey = equipmentSlots[slot];
          const def = itemKey ? TOOL_ITEM_DEFS[itemKey] : null;
          const cell = document.createElement('div');
          cell.className = 'inv-equip-slot' + (activeTool === slot ? ' active-slot' : '') + (def ? ' occupied' : '');
          cell.setAttribute('title', slot + (def ? ': ' + def.label : ' (empty)'));
          if (def) {
            const img = document.createElement('img');
            img.src = def.sprite; img.className = 'ies-sprite'; img.alt = def.label;
            cell.appendChild(img);
            const unBtn = document.createElement('button');
            unBtn.className = 'ies-unequip'; unBtn.textContent = '✕'; unBtn.title = 'Unassign ' + def.label;
            unBtn.addEventListener('click', (e) => { e.stopPropagation(); unequipItem(slot); });
            cell.appendChild(unBtn);
          }
          const lbl = document.createElement('span');
          lbl.className = 'ies-label';
          lbl.textContent = slot.charAt(0).toUpperCase() + slot.slice(1);
          cell.appendChild(lbl);
          cell.addEventListener('click', () => { setActiveTool(slot); buildEquipmentSlots(); });
          toolRow.appendChild(cell);
        }
        sec.appendChild(toolRow);

        // ── Owned Tools (gear inventory) ──────────────────────
        const ownedHdr = document.createElement('div');
        ownedHdr.className = 'inv-equip-label';
        ownedHdr.textContent = 'Owned Tools';
        sec.appendChild(ownedHdr);

        const gearTools = Object.keys(gearInventory?.tools || {}).filter(k => gearInventory.tools[k] && TOOL_ITEM_DEFS[k]);
        if (gearTools.length) {
          const gearRow = document.createElement('div');
          gearRow.className = 'inv-equip-row';
          for (const key of gearTools) {
            const def = TOOL_ITEM_DEFS[key];
            const cell = document.createElement('div');
            cell.className = 'inv-equip-slot';
            cell.setAttribute('title', def.label + ' — click to assign');
            const img = document.createElement('img');
            img.src = def.sprite; img.className = 'ies-sprite'; img.alt = def.label;
            cell.appendChild(img);
            const lbl = document.createElement('span');
            lbl.className = 'ies-label';
            lbl.textContent = def.label.split(' ')[0];
            cell.appendChild(lbl);
            cell.addEventListener('click', () => selectGearTool(key));
            gearRow.appendChild(cell);
          }
          sec.appendChild(gearRow);
        } else {
          const empty = document.createElement('div');
          empty.className = 'inv-equip-empty';
          empty.textContent = 'No tools in gear.';
          sec.appendChild(empty);
        }

        ensureGearClothingCollection();

        // ── Clothing Slots ────────────────────────────────────
        const clothHdr = document.createElement('div');
        clothHdr.className = 'inv-equip-label';
        clothHdr.textContent = 'Clothing';
        sec.appendChild(clothHdr);

        const clothRow = document.createElement('div');
        clothRow.className = 'inv-equip-row';
        for (const slot of ['hat', 'hood', 'torso', 'overwear']) {
          const item = gearInventory?.clothing?.[slot];
          const cell = document.createElement('div');
          cell.className = 'inv-equip-slot clothing-slot' + (item ? ' occupied' : '');
          cell.setAttribute('title', slot + (item ? ': ' + item.label : ' (empty)'));
          if (item) {
            renderClothingIcon(cell, item);
            const nameEl = document.createElement('span');
            nameEl.className = 'ies-cloth-name'; nameEl.textContent = item.label;
            cell.appendChild(nameEl);
          }
          const lbl = document.createElement('span');
          lbl.className = 'ies-label';
          lbl.textContent = slot.charAt(0).toUpperCase() + slot.slice(1);
          cell.appendChild(lbl);
          if (item) cell.addEventListener('click', () => selectGearClothing(slot, item));
          clothRow.appendChild(cell);
        }
        sec.appendChild(clothRow);

        const ownedClothing = (gearInventory?.clothingItems || []).filter(Boolean);
        const ownedClothHdr = document.createElement('div');
        ownedClothHdr.className = 'inv-equip-label';
        ownedClothHdr.textContent = 'Owned Clothing';
        sec.appendChild(ownedClothHdr);
        if (ownedClothing.length) {
          const ownedClothRow = document.createElement('div');
          ownedClothRow.className = 'inv-equip-row inv-owned-clothing-row';
          for (const item of ownedClothing) {
            const worn = gearInventory?.clothing?.[item.slot]?.uid === item.uid;
            const cell = document.createElement('div');
            cell.className = 'inv-equip-slot clothing-owned-slot occupied' + (worn ? ' active-slot' : '');
            cell.setAttribute('title', item.label + (worn ? ' — currently worn' : ' — click to equip'));
            renderClothingIcon(cell, item);
            const lbl = document.createElement('span');
            lbl.className = 'ies-label';
            lbl.textContent = item.slot.charAt(0).toUpperCase() + item.slot.slice(1);
            cell.appendChild(lbl);
            cell.addEventListener('click', () => selectGearClothing(item.slot, item));
            ownedClothRow.appendChild(cell);
          }
          sec.appendChild(ownedClothRow);
        } else {
          const empty = document.createElement('div');
          empty.className = 'inv-equip-empty';
          empty.textContent = 'No collected clothing in gear.';
          sec.appendChild(empty);
        }
        buildWhistleEquipUI();
      }

      function equipWhistle(whistleId) {
        equipmentSlots.whistle = whistleId;
        saveGearInventory();
        buildWhistleEquipUI();
      }

      function unequipWhistle() {
        equipmentSlots.whistle = null;
        saveGearInventory();
        buildWhistleEquipUI();
      }

      function buildWhistleEquipUI() {
        const sec = document.getElementById('invWhistleSection');
        if (!sec) return;
        sec.innerHTML = '';
        const whistles = gearInventory?.whistles || [];
        if (!whistles.length) {
          const empty = document.createElement('div');
          empty.className = 'inv-gear-extra-empty';
          empty.textContent = 'No whistles in gear.';
          sec.appendChild(empty);
          return;
        }
        const row = document.createElement('div');
        row.className = 'inv-equip-row';
        for (const whistle of whistles) {
          const def = CREATURE_DB[whistle.creatureKey];
          const equipped = equipmentSlots.whistle === whistle.id;
          const cell = document.createElement('div');
          cell.className = 'inv-equip-slot occupied' + (equipped ? ' active-slot' : '');
          cell.setAttribute('title', `${whistle.name} (${def?.label || whistle.creatureKey})` + (equipped ? ' — equipped' : ' — click to equip'));
          if (def?.sprites?.idle) {
            const img = document.createElement('img');
            img.src = def.sprites.idle; img.className = 'ies-sprite'; img.alt = whistle.name;
            cell.appendChild(img);
          }
          if (equipped) {
            const unBtn = document.createElement('button');
            unBtn.className = 'ies-unequip'; unBtn.textContent = '✕'; unBtn.title = 'Unequip ' + whistle.name;
            unBtn.addEventListener('click', (e) => { e.stopPropagation(); unequipWhistle(); });
            cell.appendChild(unBtn);
          }
          const lbl = document.createElement('span');
          lbl.className = 'ies-label';
          lbl.textContent = whistle.name;
          cell.appendChild(lbl);
          cell.addEventListener('click', () => equipWhistle(whistle.id));
          row.appendChild(cell);
        }
        sec.appendChild(row);
      }

      let activeItemIndex = 0;
      // Declared before createInitialGrid() because recomputeWater() (called
      // inside createInitialGrid) sets these — they must not be in TDZ.
      let _waterSimDirty = true;
      let _flowingTrenchTiles = [];
      let grid = createInitialGrid();
      // Apply any saved farm layout (tile overrides only; object positions applied after initWorldObjects)
      { const _savedLayout = loadFarmLayout(); if (_savedLayout) applyFarmLayoutToGrid(_savedLayout); }

      // ── Area-switching state ───────────────────────────────────────
      let currentArea     = 'farm';   // 'farm' | 'interior'
      let farmPlayerSave  = null;     // {x,y,angle} saved when entering house
      let sceneTransAlpha = 0;        // 0 = fully clear, 1 = fully black
      let sceneTransDir   = 0;        // 0=idle  1=darkening  -1=brightening
      let sceneTransCb    = null;     // fired once at peak darkness
      let sceneTransFromArea = null;  // area the player was in when the fade started

      function getActiveCols() { return currentArea === 'interior' ? INTERIOR_COLS : currentArea === 'town' ? (_townZone?.cols || 60) : _isBuildingArea(currentArea) ? (_buildingScenes.get(currentArea)?.cols || 20) : _isZoneArea(currentArea) ? (_zoneScenes.get(currentArea)?.cols || EXTERIOR_ZONES[currentArea]?.cols || _zoneLayouts.get(currentArea)?.cols) : COLS; }
      function getActiveRows() { return currentArea === 'interior' ? INTERIOR_ROWS : currentArea === 'town' ? (_townZone?.rows || 50) : _isBuildingArea(currentArea) ? (_buildingScenes.get(currentArea)?.rows || 20) : _isZoneArea(currentArea) ? (_zoneScenes.get(currentArea)?.rows || EXTERIOR_ZONES[currentArea]?.rows || _zoneLayouts.get(currentArea)?.rows) : ROWS; }
      function getActiveGrid() { return currentArea === 'interior' ? interiorGrid : currentArea === 'town' ? townGrid : _isBuildingArea(currentArea) ? (_buildingScenes.get(currentArea)?.grid || grid) : _isZoneArea(currentArea) ? (_zoneScenes.get(currentArea)?.grid || buildZoneScene(currentArea).grid) : grid; }
      function getActiveScene() { return _isBuildingArea(currentArea) ? (_buildingScenes.get(currentArea)?.scene || scene) : _isZoneArea(currentArea) ? (_zoneScenes.get(currentArea)?.scene || buildZoneScene(currentArea).scene) : currentArea === 'interior' ? interiorScene : currentArea === 'town' ? (townScene || scene) : scene; }
      function getActiveTileAt(col, row) {
        const g = getActiveGrid();
        return g[row]?.[col] || { type: TileType.ROCK, water: 0, crop: CropType.NONE, cropAge: 0, cropReady: false, stress: '', variation: 0 };
      }

      // Whether a farm-grid tile falls inside the house footprint
      function isHouseFootprint(col, row) {
        return col >= HOUSE_COL && col < HOUSE_COL + HOUSE_FOOTPRINT_W
            && row >= HOUSE_ROW && row < HOUSE_ROW + HOUSE_FOOTPRINT_D;
      }
      function rotateBuildingCollisionCell(localX, localY, width, depth, rotationDeg) {
        const rot = ((Math.round((rotationDeg || 0) / 90) * 90) % 360 + 360) % 360;
        if (rot === 90)  return { x: localY, y: width - 1 - localX };
        if (rot === 180) return { x: width - 1 - localX, y: depth - 1 - localY };
        if (rot === 270) return { x: depth - 1 - localY, y: localX };
        return { x: localX, y: localY };
      }
      function _buildingFootprintBlocks(bldg, piece, col, row) {
        const originX = bldg.gridX ?? bldg.col ?? 0;
        const originZ = bldg.gridZ ?? bldg.row ?? 0;

        if (!piece?.footprint) {
          const fbRot = ((Math.round((bldg.rotationDeg || bldg.rotation || 0) / 90) * 90) % 360 + 360) % 360;
          const fbSwap = fbRot === 90 || fbRot === 270;
          const width = fbSwap ? (bldg.footprintD ?? bldg.h ?? 1) : (bldg.footprintW ?? bldg.w ?? 1);
          const depth = fbSwap ? (bldg.footprintW ?? bldg.w ?? 1) : (bldg.footprintD ?? bldg.h ?? 1);
          return col >= originX && row >= originZ && col < originX + width && row < originZ + depth;
        }

        const structuralCells = piece.footprint.cells || [];
        const fencePostCells = piece.footprint.extensions?.railings || [];
        const collisionCells = structuralCells.concat(fencePostCells);
        if (!collisionCells.length) return false;

        const allBuildingCells = []
          .concat(piece.footprint.cells || [])
          .concat(piece.footprint.extensions?.entryTunnels || [])
          .concat(piece.footprint.extensions?.chimneys || [])
          .concat(piece.footprint.extensions?.porches || [])
          .concat(piece.footprint.extensions?.porchStairs || [])
          .concat(piece.footprint.extensions?.railings || []);
        const minX = Math.min(...allBuildingCells.map(cell => cell.x));
        const minY = Math.min(...allBuildingCells.map(cell => cell.y));
        const maxX = Math.max(...allBuildingCells.map(cell => cell.x));
        const maxY = Math.max(...allBuildingCells.map(cell => cell.y));
        const width = maxX - minX + 1;
        const depth = maxY - minY + 1;

        return collisionCells.some(cell => {
          const rotated = rotateBuildingCollisionCell(
            cell.x - minX,
            cell.y - minY,
            width,
            depth,
            bldg.rotationDeg || bldg.rotation || 0,
          );
          return col === originX + rotated.x && row === originZ + rotated.y;
        });
      }
      // `area` defaults to 'town'; any zone mapId with its own merged buildings
      // (see _spawnZoneBuildings / _zoneBuildingGroups) is also accepted, so the
      // same collision rules apply to a building placed on a plateau zone map.
      function isTownBuildingCollisionTile(col, row, area) {
        area = area || 'town';
        if (area === 'town') {
          // Building-entrance transition tiles are always walkable (they ARE the door approach)
          if (worldTownTransitions.some(t => t.target === 'building' && t.col === col && t.row === row)) return false;
          const loadedBuildingGroups = _townBuildingGroups.filter(entry => entry.piece?.footprint);
          const buildingSources = loadedBuildingGroups.length
            ? loadedBuildingGroups
            : _townBuildingDefs.map(bldg => ({ bldg, piece: null }));
          return buildingSources.some(({ bldg, piece }) => _buildingFootprintBlocks(bldg, piece, col, row));
        }

        const loadedZoneGroups = (_zoneBuildingGroups.get(area) || []).filter(entry => entry.piece?.footprint);
        const zoneBuildingSources = loadedZoneGroups.length
          ? loadedZoneGroups
          : (_zoneLayouts.get(area)?.buildings || []).map(bldg => ({ bldg, piece: null }));
        return zoneBuildingSources.some(({ bldg, piece }) => _buildingFootprintBlocks(bldg, piece, col, row));
      }
      // The two tiles immediately north of the door act as a second entrance
      function isHouseEntranceTile(col, row) {
        return row === DOOR_ROW - 1 && col >= DOOR_COL && col <= DOOR_COL + 1;
      }

      // Interior grid: 12×12 — main room cols 0-11 rows 0-9, south corridor cols 4-7 rows 10-11
      const interiorGrid = (() => {
        const floor = (c, r) =>
          (r <= 9 && c >= 0 && c <= 11) || (r >= 10 && r <= 11 && c >= 4 && c <= 7);
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
      let heldMode = 'tool'; // 'tool' | 'item'
      // Snapshot of { heldMode, tool, itemIndex } taken when the weapon
      // quick-switch engages; null when not engaged. 'weapon' is no longer
      // one of the regular tool-select options (see WHEEL_SLOTS below) —
      // this snapshot/restore toggle is the only way in and out of it.
      let weaponQuickSwitchSaved = null;
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
      let targetAimAngle = -Math.PI / 2;

      // Mouse-look: on desktop, facing tracks the mouse cursor in world space.
      // After MOUSE_IDLE_MS of no mouse movement, reverts to input-direction facing.
      const MOUSE_IDLE_MS  = 1800;  // ms before reverting to input-direction mode
      let mouseLookAngle   = -Math.PI / 2;
      let mouseLookActive  = false;
      let controllerLookAngle = -Math.PI / 2;
      let controllerLookActive = false;
      let lastMouseMoveTime = 0;
      const _raycaster     = isDesktop ? new THREE.Raycaster() : null;
      const _mouseNDC      = isDesktop ? new THREE.Vector2()   : null;
      const _groundPlane   = isDesktop ? new THREE.Plane(new THREE.Vector3(0,1,0), 0) : null;
      const _mouseWorld    = isDesktop ? new THREE.Vector3()   : null;
      // Editor-specific raycaster (always available, used by farm editor on both desktop and touch)
      const _edRay = new THREE.Raycaster();
      const _edNDC = new THREE.Vector2();
      const _edPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const _edHit  = new THREE.Vector3();
      function _screenToFarmTile(clientX, clientY) {
        const rect = threeContainer.getBoundingClientRect();
        _edNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        _edNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        _edRay.setFromCamera(_edNDC, camera);
        if (_edRay.ray.intersectPlane(_edPlane, _edHit)) {
          return { col: clamp(Math.floor(_edHit.x), 0, COLS - 1), row: clamp(Math.floor(_edHit.z), 0, ROWS - 1) };
        }
        return null;
      }

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
      let lightningTimer = 6 + Math.random() * 8;
      let lightningStrikesRemaining = 0;
      let lightningGapTimer = 0;
      let lightningDecayRate = 0;

      function createInitialGrid() {
        const nextGrid = Array.from({ length: ROWS }, (_, row) => (
          Array.from({ length: COLS }, (_, col) => createDayOneTile(col, row))
        ));

        // Used to keep day-one from being visually uniform while still beginning mostly wild.
        const rocks  = [[1,1],[10,1],[15,2],[3,7],[13,9],[16,11],[20,2],[28,4],[33,1],[22,8],[30,10],[25,14],[7,18],[18,20],[31,22],[5,24],[14,16],[26,6],[32,18],[8,12]];
        const shrubs = [[6,1],[7,2],[2,4],[14,4],[4,10],[9,11],[19,3],[24,2],[29,7],[21,12],[27,15],[11,19],[23,21],[34,16],[3,22],[16,24],[12,6],[35,9],[17,13],[28,23]];
        rocks.forEach(([col, row]) => { nextGrid[row][col].type = TileType.ROCK; });
        shrubs.forEach(([col, row]) => { nextGrid[row][col].type = TileType.SHRUB; });

        // Small test pond in the top-left corner — lets fishing be checked on
        // the farm (otherwise only town/wilderness zones have fishable water).
        const farmPondTiles = [[1,1],[2,1],[1,2],[2,2],[3,2],[2,3]];
        farmPondTiles.forEach(([col, row]) => { nextGrid[row][col].type = TileType.RIVER; nextGrid[row][col].water = MAX_WATER; });

        // Path from farm (col 17, row 0 = north exit to town) going south into the farmstead
        const farmPathTiles = [
          [16,0],[17,0],[18,0],
          [16,1],[17,1],[18,1],
          [16,2],[17,2],[18,2],
          [16,3],[17,3],[18,3],
          [16,4],[17,4],[18,4],
        ];
        farmPathTiles.forEach(([c, r]) => { nextGrid[r][c].type = TileType.PATH; });

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
          depth:     0,      // trench depth 0..1 (1 = freshly dug); siltation lowers it over time
          crop:      CropType.NONE,
          cropAge:   0,
          cropReady: false,
          stress:    '',
          variation: pattern
        };
      }

      function tickPlayerFootsteps(prevX, prevY) {
        const dist = Math.hypot(player.x - prevX, player.y - prevY);
        if (!_footstepAdvance(player, dist, FOOTSTEP_PLAYER_STRIDE_PX)) return;
        const type = footstepTileTypeAt(currentArea, player.x, player.y, getActiveGrid());
        playFootstepSfx(currentArea, type, 1);
      }

      function updateMovement(dt) {
        if (dialogueOpen) { updateNpcDialogueStaging(dt); return; }
        if (fishingMinigame?.active) return;

        const _fsPrevX = player.x, _fsPrevY = player.y;

        if (player.climbing) {
          updateClimb(dt);
          return;
        }

        if (player.dodging) {
          player.dodgeT -= dt;
          const minX = PLAYER_RADIUS, maxX = getActiveCols() * TILE - PLAYER_RADIUS;
          const minY = PLAYER_RADIUS, maxY = getActiveRows() * TILE - PLAYER_RADIUS;
          const desiredX = clamp(player.x + player.dodgeDirX * DODGE_SPEED_PX * dt, minX, maxX);
          const desiredY = clamp(player.y + player.dodgeDirY * DODGE_SPEED_PX * dt, minY, maxY);
          const dodgeSwept = sweptMove(player.x, player.y, desiredX, desiredY, canPlayerOccupy);
          player.x = dodgeSwept.x; player.y = dodgeSwept.y;
          player.vx = player.dodgeDirX * DODGE_SPEED_PX;
          player.vy = player.dodgeDirY * DODGE_SPEED_PX;
          if (player.dodgeT <= 0) {
            player.dodging = false;
            player.vx = 0; player.vy = 0;
          }
          tickPlayerFootsteps(_fsPrevX, _fsPrevY);
          return;
        }

        if (player.knockbackT > 0) {
          player.knockbackT = Math.max(0, player.knockbackT - dt);
          const minX = PLAYER_RADIUS, maxX = getActiveCols() * TILE - PLAYER_RADIUS;
          const minY = PLAYER_RADIUS, maxY = getActiveRows() * TILE - PLAYER_RADIUS;
          const desiredX = clamp(player.x + player.knockbackVX * dt, minX, maxX);
          const desiredY = clamp(player.y + player.knockbackVY * dt, minY, maxY);
          const kbSwept = sweptMove(player.x, player.y, desiredX, desiredY, canPlayerOccupy);
          player.x = kbSwept.x; player.y = kbSwept.y;
          if (kbSwept.blockedX) player.knockbackVX = 0;
          if (kbSwept.blockedY) player.knockbackVY = 0;
          player.vx = player.knockbackVX;
          player.vy = player.knockbackVY;
          if (player.knockbackT <= 0) { player.vx = 0; player.vy = 0; }
          tickPlayerFootsteps(_fsPrevX, _fsPrevY);
          return;
        }

        if (player.lunging) {
          player.lungeT = Math.max(0, player.lungeT - dt);
          const t = 1 - player.lungeT / player.lungeDur;
          const eased = 1 - Math.pow(1 - t, 3); // ease-out: fast off the top, settles into the landing
          const minX = PLAYER_RADIUS, maxX = getActiveCols() * TILE - PLAYER_RADIUS;
          const minY = PLAYER_RADIUS, maxY = getActiveRows() * TILE - PLAYER_RADIUS;
          const desiredX = clamp(player.lungeStartX + player.lungeDirX * player.lungeDistancePx * eased, minX, maxX);
          const desiredY = clamp(player.lungeStartY + player.lungeDirY * player.lungeDistancePx * eased, minY, maxY);
          // Swept, not a single endpoint check — this recomputes an absolute
          // target from total elapsed progress every frame (ease-out is
          // fastest right at the start), so a big lunge like Charged
          // Breaker's ~7 tiles can cover more than a tile in one frame and
          // would otherwise tunnel clean through a one-tile-thick plateau
          // wall instead of stopping at it.
          const lungeSwept = sweptMove(player.x, player.y, desiredX, desiredY, canPlayerOccupy);
          player.x = lungeSwept.x; player.y = lungeSwept.y;
          player.lungeHopCurrent = player.lungeHopUnits * Math.sin(eased * Math.PI);
          if (player.lungeT <= 0) { player.lunging = false; player.lungeHopCurrent = 0; }
          tickPlayerFootsteps(_fsPrevX, _fsPrevY);
          return;
        }

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
          const aimDeadzone = Number(window.SCRATCHBONES_CONFIG?.game?.input?.targeting?.inputAimDeadzone) || 0.08;
          if (inputStrength >= aimDeadzone && !controllerLookActive && !(isDesktop && mouseLookActive)) targetAimAngle = Math.atan2(iy, ix);
        }

        // Raw per-frame move intent, read by hold abilities (Blink Dodge)
        // that need to know which way the player is trying to go.
        player.inputX = ix;
        player.inputY = iy;
        player.inputStrength = inputStrength;

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
        // Lets a held movement ability (Blink Dodge) slow normal walking
        // while it's converting movement into zips; 1 (no change) otherwise.
        const combatSpeedMul = window.Combat?.getMovementSpeedMul ? window.Combat.getMovementSpeedMul() : 1;
        const targetSpeed = MOVE_SPEED * speedMul * analogEase * combatSpeedMul;
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
        // Computed once per frame: also drives the touch dodge button, which
        // only matters in combat (same condition as the facing lock below).
        // Auto-targeting only engages while an actual weapon item is
        // equipped in the weapon slot (not just the slot being active).
        const weaponEngaged = activeTool === 'weapon' && !!equipmentSlots.weapon;
        const autoTarget = weaponEngaged ? findAutoTarget() : null;
        dodgeBtn?.classList.toggle('combat-active', !!autoTarget);
        btnSwapTarget?.classList.toggle('abt-hidden', !weaponEngaged);
        btnWeaponSwitch?.classList.toggle('active', activeTool === 'weapon');

        // Auto-aim lock takes absolute priority over mouse-look/right-stick
        // look while it's engaged, so neither can interrupt or steal facing
        // away from the locked target — the only things that release it are
        // an attack swing in progress (toolSwingT > 0; the swing pose drives
        // its own body rotation) or the weapon being switched away from /
        // unequipped (weaponEngaged false, so autoTarget is already null).
        const autoAiming = !!autoTarget && toolSwingT <= 0;

        if (autoAiming) {
          const targetAngle = Math.atan2(autoTarget.y - player.y, autoTarget.x - player.x);
          const diff = angleDiff(targetAngle, facingAngle);
          facingAngle += diff * Math.min(1, FACING_LERP * 2 * dt);
          if (inputStrength > 0.001) lastMoveAngle = Math.atan2(iy, ix);
          cardinalHoldTimer = CARDINAL_HOLD;
          player.angle = facingAngle;
        } else {
          if (controllerLookActive) {
            const diff = angleDiff(controllerLookAngle, facingAngle);
            facingAngle += diff * Math.min(1, FACING_LERP * 2.5 * dt);
            player.angle = facingAngle;
            if (inputStrength > 0.001) lastMoveAngle = Math.atan2(iy, ix);
          } else if (isDesktop && mouseLookActive) {
            if (performance.now() - lastMouseMoveTime > MOUSE_IDLE_MS) {
              mouseLookActive = false;
            } else {
              const diff = angleDiff(mouseLookAngle, facingAngle);
              facingAngle += diff * Math.min(1, FACING_LERP * 2.5 * dt);
              player.angle = facingAngle;
              if (inputStrength > 0.001) lastMoveAngle = Math.atan2(iy, ix);
            }
          }

          if (!controllerLookActive && (!mouseLookActive || !isDesktop)) {
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
        }

        // ── Boundary clamp ────────────────────────────────────
        player.x = clamp(player.x, PLAYER_RADIUS, getActiveCols() * TILE - PLAYER_RADIUS);
        player.y = clamp(player.y, PLAYER_RADIUS, getActiveRows() * TILE - PLAYER_RADIUS);

        tickPlayerFootsteps(_fsPrevX, _fsPrevY);
      }

      // Generalized footprint-occupancy check (a square of side 2*radius is free
      // of solid terrain / map edges), shared by the player and by creature
      // attacks that need to know when a forced movement (e.g. a pounce leap)
      // has run into something.
      function canOccupyAt(wx, wy, radius) {
        const aC = getActiveCols(), aR = getActiveRows();
        if (wx - radius < 0 || wy - radius < 0 || wx + radius >= aC * TILE || wy + radius >= aR * TILE) return false;
        return tileSpeedAt(wx - radius, wy - radius) !== null
            && tileSpeedAt(wx + radius, wy - radius) !== null
            && tileSpeedAt(wx - radius, wy + radius) !== null
            && tileSpeedAt(wx + radius, wy + radius) !== null;
      }

      function canPlayerOccupy(wx, wy) {
        return canOccupyAt(wx, wy, PLAYER_RADIUS * 0.72);
      }

      // A fast forced move (combat lunge, knockback, dodge) recomputes its
      // target position from total elapsed progress every frame rather than
      // stepping a small fixed distance, so a single frame's jump can easily
      // exceed one tile — e.g. Charged Breaker's ~7-tile lunge covers most of
      // its distance in its very first frames (ease-out is fastest at t=0).
      // Testing occupancy only at that frame's endpoint lets it tunnel clean
      // through a one-tile-thick solid wall (a plateau's incline face)
      // instead of stopping at it. Subdividing the straight line from the
      // current position to the desired one into small steps and testing
      // each one — same per-axis sliding behavior as a single check, just
      // repeated — closes that gap for any of these forced moves.
      // blockedX/blockedY report whether that axis was ever rejected during
      // the sweep, so a caller (e.g. knockback) can zero out that axis's
      // velocity exactly like the old single-check version did.
      const COLLISION_SWEEP_STEP_PX = TILE * 0.25;
      function sweptMove(curX, curY, desiredX, desiredY, canOccupyFn) {
        const dx = desiredX - curX, dy = desiredY - curY;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.001) return { x: curX, y: curY, blockedX: false, blockedY: false };
        const steps = Math.max(1, Math.ceil(dist / COLLISION_SWEEP_STEP_PX));
        const stepX = dx / steps, stepY = dy / steps;
        let x = curX, y = curY, blockedX = false, blockedY = false;
        for (let i = 0; i < steps; i++) {
          const nx = x + stepX, ny = y + stepY;
          if (canOccupyFn(nx, y)) x = nx; else blockedX = true;
          if (canOccupyFn(x, ny)) y = ny; else blockedY = true;
        }
        return { x, y, blockedX, blockedY };
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
        const tile = getActiveGrid()[row][col];
        if (tile.type === TileType.ROCK) return false;
        if (currentArea === 'farm' && isHouseFootprint(col, row) && !isHouseEntranceTile(col, row)) return false;
        // Town terrain is fixed set-dressing — dig/fill/raise/till/smooth are
        // farm-only mechanics, and pick duplicates the shovel's terrain actions.
        if (currentArea === 'town' && (tool === 'shovel' || tool === 'hoe' || tool === 'pick')) return false;
        if (tool === 'shovel') {
          if (action === 'dig') {
            if (blocksDiggingUnder(tile)) return false;
            // An already-dug trench can be redug (single tap) once rain has silted it shallower.
            if (tile.type === TileType.TRENCH) return (tile.depth ?? 1) < 1;
            return [TileType.GRASS, TileType.TILLED, TileType.RAISED].includes(tile.type) || isDigRemovableVegetation(tile);
          }
          if (action === 'fill') return tile.type === TileType.TRENCH;
          if (action === 'raise') return [TileType.GRASS, TileType.TILLED].includes(tile.type) && !tile.crop;
        }
        if (tool === 'hoe') {
          if (action === 'till') return tile.type === TileType.GRASS && !tile.crop;
          if (action === 'smooth') return [TileType.TILLED, TileType.RAISED, TileType.PADDY].includes(tile.type) && !tile.crop;
        }
        if (tool === 'weapon') return true; // combat hits are cone-based, not tile-gated
        if (tool === 'harpoon' && action === 'fish') {
          return tile.type === TileType.RIVER || tile.type === TileType.STREAM;
        }
        if (tool === 'machete' || tool === 'axe') {
          const targets = getMacheteTargets(col, row, action);
          const tgrid = getActiveGrid();
          return targets.some(t => {
            const targetTile = tgrid[t.row]?.[t.col];
            return targetTile && !targetTile.crop && (targetTile.type === TileType.WEEDS || targetTile.type === TileType.SHRUB);
          });
        }
        if (tool === 'pick') {
          if (action === 'dig') {
            if (blocksDiggingUnder(tile)) return false;
            // An already-dug trench can be redug (single tap) once rain has silted it shallower.
            if (tile.type === TileType.TRENCH) return (tile.depth ?? 1) < 1;
            return [TileType.GRASS, TileType.TILLED, TileType.RAISED].includes(tile.type) || isDigRemovableVegetation(tile);
          }
          if (action === 'fill') return tile.type === TileType.TRENCH;
          if (action === 'raise') return [TileType.GRASS, TileType.TILLED].includes(tile.type) && !tile.crop;
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
        const acols = getActiveCols(), arows = getActiveRows();
        const clampedCenter = { col: clamp(col, 0, acols - 1), row: clamp(row, 0, arows - 1) };
        if (action !== 'slash' && action !== 'hack') return [clampedCenter];

        // Slash uses a simple three-tile cone: the aimed tile plus its two side tiles relative to facing.
        const dir = facingCardinal(player.angle);
        const side = dir.x !== 0 ? { x: 0, y: 1 } : { x: 1, y: 0 };
        const seen = new Set();
        return [
          clampedCenter,
          { col: clampedCenter.col + side.x, row: clampedCenter.row + side.y },
          { col: clampedCenter.col - side.x, row: clampedCenter.row - side.y },
        ].filter(t => {
          if (t.col < 0 || t.col >= acols || t.row < 0 || t.row >= arows) return false;
          const key = `${t.col},${t.row}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }

      function clearVegetationAt(col, row, action) {
        const targets = getMacheteTargets(col, row, action);
        const tgrid = getActiveGrid();
        let cleared = 0;
        for (const t of targets) {
          const tile = tgrid[t.row][t.col];
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
        if (action === 'cut' || action === 'slash' || action === 'chop' || action === 'hack') {
          const isWide = action === 'slash' || action === 'hack';
          return { emoji: '✦', color: '#7fe89a', count: isWide ? 20 : 12, spread: isWide ? 0.78 : 0.48, lift: -0.8, ring: '#7fe89a' };
        }
        if (action === 'harvest') return { emoji: '✧', color: '#f9e28a', count: 16, spread: 0.50, lift: -0.9, ring: '#f9e28a' };
        if (action.startsWith('plant')) return { emoji: '•', color: '#9ff08a', count: 11, spread: 0.36, lift: -0.55, ring: '#9ff08a' };
        if (action.startsWith('place_')) return { emoji: '◆', color: '#f9e28a', count: 12, spread: 0.42, lift: -0.65, ring: '#f9e28a' };
        if (action.startsWith('obj_process_')) return { emoji: '✧', color: '#e7b85c', count: 14, spread: 0.44, lift: -0.75, ring: '#e7b85c' };
        return { emoji: '•', color: '#f9e28a', count: 10, spread: 0.42, lift: -0.65, ring: '#f9e28a' };
      }

      function spawnActionParticles(col, row, action, ok) {
        const profile = actionFxProfile(action, ok);
        const agrid = getActiveGrid();
        const baseY = tileSurfaceY(agrid[row][col].type) + 0.16 + Math.max(0, agrid[row][col].water * WATER_UNIT);
        actionTileEffects.push({ col, row, action, ok, age: 0, maxAge: ok ? 0.58 : 0.44, color: profile.ring });
        while (actionTileEffects.length > 8) actionTileEffects.shift();
        if (activeTool === 'weapon' && action === 'cut') spawnWeaponTrailEffect(action, ok);
        else if (action === 'slash') spawnWeaponTrailEffect(action, ok, col, row);

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


      // Half the player avatar's own prism height above the ground it's
      // standing on — playerMesh.position.y already tracks that ground
      // level (see the lerp toward targetY below), and the avatar plane
      // itself is bottom-edge anchored there, so its world-space vertical
      // center is exactly ground + height/2.
      function playerPrismHeightTiles() {
        let h = null;
        playerMesh?.traverse?.(child => {
          if (h == null && Number.isFinite(child.userData?.portraitModelHeight)) h = child.userData.portraitModelHeight;
        });
        return h ?? (window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.worldModelWidth ?? 0.9);
      }
      function weaponTrailCenterY() {
        return playerMesh.position.y + playerPrismHeightTiles() / 2;
      }

      // Random seed points scattered across the swing's actual swept shape
      // (trapezoid or cone), each driving one particle in the burst rather
      // than one flat filled polygon — see drawWeaponTrailEffects().
      const WEAPON_TRAIL_PARTICLE_COUNT = 9;
      function weaponTrailParticleSeeds(fx) {
        const seeds = [];
        for (let i = 0; i < WEAPON_TRAIL_PARTICLE_COUNT; i++) {
          let dx, dz, outAngle;
          if (fx.isCone) {
            const a = fx.angle - fx.halfConeRad + (2 * fx.halfConeRad) * Math.random();
            const r = fx.rangeTiles * (0.25 + Math.random() * 0.75);
            dx = Math.cos(a) * r; dz = Math.sin(a) * r; outAngle = a;
          } else {
            const along = 0.15 + Math.random() * fx.far;
            const across = (Math.random() * 2 - 1) * fx.halfWidth;
            dx = fx.dir.x * along + fx.side.x * across;
            dz = fx.dir.y * along + fx.side.y * across;
            outAngle = Math.atan2(fx.dir.y, fx.dir.x);
          }
          seeds.push({ dx, dz, outAngle, jitterY: (Math.random() - 0.5) * 0.16, drift: 0.15 + Math.random() * 0.25, size: 5 + Math.random() * 5 });
        }
        return seeds;
      }

      function spawnWeaponTrailEffect(action, ok, col = null, row = null) {
        const abil = weaponAbility(action) || weaponAbility('slash');
        const tileAnchored = col !== null && row !== null;
        const dir = tileAnchored ? facingCardinal(player.angle) : { x: Math.cos(player.angle), y: Math.sin(player.angle) };
        const side = tileAnchored
          ? (dir.x !== 0 ? { x: 0, y: 1 } : { x: 1, y: 0 })
          : { x: -dir.y, y: dir.x };
        const fx = {
          x: col === null ? player.x / TILE : col + 0.5,
          z: row === null ? player.y / TILE : row + 0.5,
          dir, side, action,
          halfWidth: abil.trailHalfWidthTiles,
          far: abil.trailFarTiles,
          age: 0,
          maxAge: ok ? abil.trailMaxAgeSeconds : Math.max(abil.trailMaxAgeSeconds * 0.72, 0.1),
          ok,
          y: weaponTrailCenterY(),
        };
        fx.particles = weaponTrailParticleSeeds(fx);
        weaponTrailEffects.push(fx);
        const limit = Number(combatConfig().weaponTrailLimit) || 5;
        while (weaponTrailEffects.length > limit) weaponTrailEffects.shift();
      }

      // Combat ability hit-cone flash — shows the actual swept area (angle +
      // range) a combat-*.js ability just resolved its inCone() hit test
      // against, since each ability/charge/combo-step uses its own rangePx/
      // halfConeRad rather than one fixed shape. Reuses weaponTrailEffects'
      // existing age/limit bookkeeping and drawWeaponTrailEffects' particle
      // renderer (isCone flag switches weaponTrailParticleSeeds onto the
      // fan-shaped sampling below instead of the farming trapezoid).
      const COMBAT_TRAIL_MAX_AGE_S = 0.24; // matches the legacy cut ability's trailMaxAgeSeconds
      function spawnCombatTrailEffect({ rangePx, halfConeRad, angle = player.angle, ok }) {
        const fx = {
          isCone: true,
          x: player.x / TILE,
          z: player.y / TILE,
          y: weaponTrailCenterY(),
          angle,
          halfConeRad,
          rangeTiles: rangePx / TILE,
          age: 0,
          maxAge: ok ? COMBAT_TRAIL_MAX_AGE_S : Math.max(COMBAT_TRAIL_MAX_AGE_S * 0.72, 0.1),
          ok,
        };
        fx.particles = weaponTrailParticleSeeds(fx);
        weaponTrailEffects.push(fx);
        const limit = Number(combatConfig().weaponTrailLimit) || 5;
        while (weaponTrailEffects.length > limit) weaponTrailEffects.shift();
      }

      // Full-circle burst at the player's position with an explicit color —
      // used for non-attack feedback like shield blocks. halfConeRad = π gives
      // a full 360° fan in weaponTrailParticleSeeds.
      function spawnBurstEffect({ color, rangePx }) {
        const fx = {
          isCone: true,
          x: player.x / TILE,
          z: player.y / TILE,
          y: weaponTrailCenterY(),
          angle: 0,
          halfConeRad: Math.PI,
          rangeTiles: rangePx / TILE,
          age: 0,
          maxAge: COMBAT_TRAIL_MAX_AGE_S * 1.4,
          ok: true,
          color,
        };
        fx.particles = weaponTrailParticleSeeds(fx);
        weaponTrailEffects.push(fx);
        const limit = Number(combatConfig().weaponTrailLimit) || 5;
        while (weaponTrailEffects.length > limit) weaponTrailEffects.shift();
      }

      // Small radial spark anchored on the creature itself (not the player,
      // unlike spawnBurstEffect/spawnCombatTrailEffect) so a hit reads
      // clearly regardless of who/what landed it — companion-on-hostile
      // damage gets the same feedback as the player's own attacks. Reuses
      // the same isCone/particle-seed rendering as every other combat
      // effect; a bright spark color keeps it visually distinct from the
      // creature's own red hitFlashT tint and the shield's blue block burst.
      const CREATURE_HIT_SPARK_COLOR = '#fff35c';
      function spawnCreatureHitSpark(c) {
        const fx = {
          isCone: true,
          x: c.x / TILE,
          z: c.y / TILE,
          y: c.avatarRef?.group?.position?.y ?? weaponTrailCenterY(),
          angle: 0,
          halfConeRad: Math.PI,
          rangeTiles: Math.max(0.35, (c.def?.modelWidth || 2) * 0.3),
          age: 0,
          maxAge: COMBAT_TRAIL_MAX_AGE_S * 1.1,
          ok: true,
          color: CREATURE_HIT_SPARK_COLOR,
        };
        fx.particles = weaponTrailParticleSeeds(fx);
        weaponTrailEffects.push(fx);
        const limit = Number(combatConfig().weaponTrailLimit) || 5;
        while (weaponTrailEffects.length > limit) weaponTrailEffects.shift();
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
        return {
          x: (v.x * 0.5 + 0.5) * _threeRect.width,
          y: (-v.y * 0.5 + 0.5) * _threeRect.height,
          visible: v.z >= -1 && v.z <= 1
        };
      }

      function drawCombatConeReticle() {
        const cfg = combatConfig().combatConeReticle || {};
        if (cfg.enabled === false || activeTool !== 'weapon' || !findAutoTarget()) return;
        const abil = weaponAbility('cut');
        if (!abil) return;
        const rangeTiles = abil.rangePx / TILE;
        const baseX = player.x / TILE;
        const baseZ = player.y / TILE;
        const y = tileSurfaceY(getActiveTileAt(Math.floor(baseX), Math.floor(baseZ)).type) + 0.035;
        const alpha = Number(cfg.alpha) || 0.24;
        const lineWidth = Number(cfg.lineWidth) || 2;
        const color = cfg.color || '#d9ffe0';
        const left = player.angle - abil.halfConeRad;
        const right = player.angle + abil.halfConeRad;
        const leftEnd = worldToOverlay(baseX + Math.cos(left) * rangeTiles, y, baseZ + Math.sin(left) * rangeTiles);
        const rightEnd = worldToOverlay(baseX + Math.cos(right) * rangeTiles, y, baseZ + Math.sin(right) * rangeTiles);
        const origin = worldToOverlay(baseX, y, baseZ);
        if (!origin.visible || !leftEnd.visible || !rightEnd.visible) return;
        octx.save();
        octx.globalAlpha = alpha;
        octx.strokeStyle = color;
        octx.lineWidth = lineWidth;
        octx.setLineDash(Array.isArray(cfg.lineDash) ? cfg.lineDash : []);
        octx.beginPath();
        octx.moveTo(origin.x, origin.y);
        octx.lineTo(leftEnd.x, leftEnd.y);
        octx.moveTo(origin.x, origin.y);
        octx.lineTo(rightEnd.x, rightEnd.y);
        octx.stroke();
        octx.restore();
      }

      function drawWeaponTrailEffects() {
        for (const fx of weaponTrailEffects) {
          const t = fx.age / fx.maxAge;
          const alpha = Math.max(0, 1 - t);
          const color = fx.color ?? (fx.ok ? '#ffdc60' : '#4488ff');
          octx.save();
          octx.fillStyle = color;
          for (const p of fx.particles) {
            // Particles drift outward along their seed angle and bob in y
            // as they age, instead of sitting still like a flat decal.
            const spread = 1 + t * p.drift;
            const wx = fx.x + p.dx * spread;
            const wz = fx.z + p.dz * spread;
            const wy = fx.y + p.jitterY + t * 0.22;
            const pos = worldToOverlay(wx, wy, wz);
            if (!pos.visible) continue;
            const r = Math.max(1.5, p.size * (1 - t * 0.5));
            octx.globalAlpha = alpha * (fx.ok ? 0.85 : 0.7);
            octx.beginPath();
            octx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
            octx.fill();
          }
          octx.restore();
        }
      }

      function drawActionTileEffects() {
        for (const fx of actionTileEffects) {
          const t = fx.age / fx.maxAge;
          const tile = getActiveGrid()[fx.row][fx.col];
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
        const tile = getActiveGrid()[row][col];

        if (tool === 'shovel') {
          if (action === 'dig' && tile.type === TileType.TRENCH) {
            tile.depth = 1;
            return { ok: true, message: 'Redug the trench back to full depth.' };
          }
          const dugVegetation = action === 'dig' && isDigRemovableVegetation(tile);
          if (action === 'dig')   { tile.type = TileType.TRENCH; tile.depth = 1; }
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

        if (tool === 'machete' || tool === 'axe') {
          const result = clearVegetationAt(col, row, action);
          const isWide = action === 'slash' || action === 'hack';
          if (result.cleared <= 0) return { ok: false, message: isWide ? 'Found no overgrowth in the swing.' : 'No overgrowth to clear here.' };
          return {
            ok: true,
            message: isWide
              ? `Cleared ${result.cleared} tile${result.cleared === 1 ? '' : 's'} in the swing into mulch.`
              : 'Cleared one tile of day-one overgrowth into mulch.'
          };
        }

        if (tool === 'weapon') {
          const hitResult = window.Combat ? window.Combat.resolveWeaponHit(action, resolveWeaponHit) : resolveWeaponHit(action);
          if (hitResult.hits > 0) return { ok: true, message: hitResult.message };
          const vegResult = clearVegetationAt(col, row, action);
          if (vegResult.cleared > 0) {
            return {
              ok: true,
              message: action === 'slash'
                ? `Slashed ${vegResult.cleared} tile${vegResult.cleared === 1 ? '' : 's'} in the cone into mulch.`
                : 'Cut one tile of day-one overgrowth into mulch.'
            };
          }
          return { ok: false, message: action === 'slash' ? 'The big sweep connects with nothing.' : 'The strike connects with nothing.' };
        }

        if (tool === 'pick') {
          if (action === 'dig' && tile.type === TileType.TRENCH) {
            tile.depth = 1;
            return { ok: true, message: 'Redug the trench back to full depth.' };
          }
          const dugVegetation = action === 'dig' && isDigRemovableVegetation(tile);
          if (action === 'dig')   { tile.type = TileType.TRENCH; tile.depth = 1; }
          if (action === 'fill')  tile.type = TileType.GRASS;
          if (action === 'raise') tile.type = TileType.RAISED;
          tile.water = 0; tile.crop = CropType.NONE; tile.cropAge = 0; tile.cropReady = false;
          const digMsg = dugVegetation ? 'Loosened the earth and cleared the vegetation.' : `${tileStyles[tile.type].label} — ${contextualActionLabel(action, tile)}.`;
          return { ok: true, message: digMsg };
        }

        if (tool === 'seeds') {
          if (action === 'harvest') return harvestCrop(tile);
          const crop = action.startsWith('plant_') ? action.slice(6) : null;
          return plantCrop(tile, crop);
        }

        return { ok: false, message: 'No action handler found.' };
      }

      function useActiveAction() {
        if (dialogueOpen) { advanceNpcDialogue(); return; }
        if (activeAction === 'climb') {
          if (player.climbing) return;
          const climb = getClimbTarget();
          if (climb) startClimb(climb); else showToast('Nothing to climb here.', false);
          return;
        }
        if (activeTool === 'shovel' || activeTool === 'pick') {
          activeAction = resolveDigFillAction(activeTool, activeAction, getReticleTile());
        }
        if (activeAction === generalStoreAction()) {
          if (nearbyNpcWalker && isGeneralStoreNpcOnDuty(nearbyNpcWalker) && !farmEditMode) { openMenu('generalStore'); return; }
          showToast(generalStoreButtonConfig().noTargetMessage || 'The general store is not available right now.', false);
          return;
        }
        if (activeAction === npcDialogueAction()) {
          if (nearbyNpcWalker && !farmEditMode) { openNpcDialogue(nearbyNpcWalker); return; }
          showToast(npcDialogueButtonConfig().noTargetMessage || 'No one nearby to talk to.', false);
          return;
        }
        // Spearfishing bypasses the normal swing timer entirely — it opens
        // its own minigame overlay instead of queuing a pendingAction.
        if (activeTool === 'harpoon' && activeAction === 'fish') {
          const reticle = getReticleTile();
          if (!canUseAction('harpoon', 'fish', reticle.col, reticle.row)) {
            showToast('No river or stream here to fish.', false);
            return;
          }
          startFishingMinigame();
          return;
        }
        // Weapon attacks route through the loadout's tap-slot abilities
        // (combo/quick attacks/etc.) instead of firing a plain swing here —
        // mirrors the mouse/touch action-bar handling further down, so
        // gamepad/keyboard "primary action" presses get the same combo and
        // windup/strike behavior instead of falling back to the pre-loadout
        // swing. Each ability deducts its own stamina cost, so there's no
        // separate check here.
        if (activeTool === 'weapon') {
          const slot = activeAction === toolActions.weapon[0] ? 1 : activeAction === toolActions.weapon[1] ? 2 : null;
          if (slot && window.Combat?.input) { window.Combat.input.fireTap(slot); return; }
        }

        // Digging a brand-new trench or filling an existing one in requires a
        // sustained hold through multiple ramping/timed swings rather than a single
        // tap — hand off to the charge state machine instead of a normal swing.
        if (wouldStartCharge(activeTool, activeAction)) {
          // Check permission before the multi-second hold starts, not after —
          // completeChargeAction() re-checks too in case a grant changes mid-charge.
          const _preChargePermCategory = farmActionPermissionCategory(activeTool, activeAction);
          if (_preChargePermCategory && !hasFarmPermission(_preChargePermCategory)) {
            const msg = "Only the farm's owner (or a granted farmhand) can do that here.";
            lastActionMessage = msg;
            showToast(msg, false);
            return;
          }
          startChargeAction(getReticleTile(), activeAction === 'fill' ? FILL_TRENCH_STAGES : DIG_NEW_TRENCH_STAGES);
          return;
        }

        const _anim = activeAnimStyle();
        toolSwingDur = _anim === 'thrust' ? 0.34 : _anim === 'chop' ? 0.42 : 0.68;
        // Dig speed only scales shovel/pick dig & fill swings (e.g. the single-tap
        // trench redig below) — everything else swings at its normal pace.
        if ((activeTool === 'shovel' || activeTool === 'pick') && (activeAction === 'dig' || activeAction === 'fill')) {
          toolSwingDur /= getDigSpeedMultiplier();
        }
        toolSwingT = toolSwingDur;
        strikeFired = false;
        pendingAction = null;

        // Spot transitions require explicit input
        if (activeAction === 'use_spot' && _pendingSpotTransition) {
          startSceneTransition(() => performTravel(_pendingSpotTransition));
          return;
        }

        // Immediate actions (navigation / world-object interactions)
        if (activeAction === 'obj_exit_house') {
          exitInterior();
          lastActionMessage = 'Stepped outside.';
          showToast(lastActionMessage, true);
          return;
        }
        if (activeAction.startsWith('obj_')) {
          const _r = getReticleTile();
          const _o = getWorldObjectAt(_r.col, _r.row);
          const _res = _o ? _o.onAction(activeAction) : { ok: false, message: 'No object here.' };
          lastActionMessage = _res.message;
          showToast(_res.message, _res.ok !== false);
          if (_res.ok !== false) saveMemberWorldData();
          return;
        }

        // All other actions are queued to fire at the start of the strike phase
        const reticle = getReticleTile();
        pendingAction = { col: reticle.col, row: reticle.row, action: activeAction, tool: activeTool };
      }

      // Only the farm (and, for furniture, the house interior) is
      // ownership-gated — wilderness/town resource gathering, combat, and
      // navigation are always open to any farmhand. Returns null when the
      // action isn't farm-alteration at all (weapon swings, obj_
      // interactions, spawn_uumkaoii debug spawns, etc.).
      function farmActionPermissionCategory(tool, action) {
        if (action.startsWith('place_')) {
          // placeDecorativeFurniture() also accepts area:'interior' pieces
          // placed inside the house — gate those too, not just the open farm.
          return (currentArea === 'farm' || currentArea === 'interior') ? 'placeFurniture' : null;
        }
        if (currentArea !== 'farm') return null;
        if (action.startsWith('plant_')) return 'plant';
        if (action === 'harvest') return 'harvest';
        if (tool === 'shovel' || tool === 'hoe' || tool === 'pick' || tool === 'machete' || tool === 'axe') return 'alterFarm';
        return null;
      }

      function firePendingAction() {
        if (!pendingAction) return;
        const { col, row, action, tool } = pendingAction;
        pendingAction = null;

        const permCategory = farmActionPermissionCategory(tool, action);
        if (permCategory && !hasFarmPermission(permCategory)) {
          const msg = "Only the farm's owner (or a granted farmhand) can do that here.";
          lastActionMessage = msg;
          showToast(msg, false);
          refreshActionBar();
          return;
        }

        const tile = getActiveGrid()[row][col];
        let result;
        if (action.startsWith('place_decor_')) {
          result = placeDecorativeFurniture(col, row, action.slice(12));
        } else if (action.startsWith('place_')) {
          result = placeProcessingFurniture(col, row, action.slice(6));
        } else if (action === 'spawn_uumkaoii') {
          result = spawnUumkaoii(col, row);
        } else if (action.startsWith('plant_')) {
          result = plantCrop(tile, action.slice(6));
        } else if (action === 'harvest') {
          result = harvestCrop(tile);
        } else {
          result = applyAction(tool, action, col, row);
        }
        lastActionMessage = result.message;
        showToast(result.message, result.ok !== false);
        spawnActionParticles(col, row, action, result.ok !== false);
        debugLog(`${result.ok ? 'ok' : 'blocked'} ${action} @ c${col},r${row}: ${result.message}`);
        // The farm tile-mesh/water systems below are farm-grid specific; off
        // the farm (town, zones) col/row index into a different grid entirely.
        if (currentArea === 'farm') {
          recomputeWater(false);
          if (result.ok !== false) markTileDirty(col, row);
        }
        if (result.ok !== false) saveMemberWorldData();
        refreshActionBar();
      }

      function targetingConfig() {
        return window.SCRATCHBONES_CONFIG?.game?.input?.targeting || {};
      }

      function getReticleTile() {
        const cfg = targetingConfig();
        const orbitRadiusTiles = Number.isFinite(Number(cfg.orbitRadiusTiles)) ? Number(cfg.orbitRadiusTiles) : 0.62;
        const angle = targetAimAngle;
        const dir = { x: Math.cos(angle), y: Math.sin(angle), name: facingCardinal(angle).name };
        // Ground-level probe: a tight orbit around the player's actual position,
        // aimed by raw input/look rotation rather than the tile the player stands on.
        const probeX = player.x + dir.x * TILE * orbitRadiusTiles;
        const probeY = player.y + dir.y * TILE * orbitRadiusTiles;
        return {
          col: clamp(Math.floor(probeX / TILE), 0, getActiveCols() - 1),
          row: clamp(Math.floor(probeY / TILE), 0, getActiveRows() - 1),
          dir,
          probeX,
          probeY
        };
      }

      function facingCardinal(angle) {
        const x = Math.cos(angle);
        const y = Math.sin(angle);
        if (Math.abs(x) > Math.abs(y)) return { x: Math.sign(x), y: 0, name: x > 0 ? 'east' : 'west' };
        return { x: 0, y: Math.sign(y), name: y > 0 ? 'south' : 'north' };
      }

      // Cliff climbing: the player must be facing straight into a plateau's
      // auto-reserved incline wall (see mergeZoneTiles) from solid ground,
      // with an actual walkable tile at a different elevation tier on the far
      // side — otherwise there's nothing to climb. Works either direction
      // (climbing up onto a plateau or back down off one uses the same check).
      const CLIMB_MAX_WALL_TILES = 4;
      function getClimbTarget() {
        if (!_isZoneArea(currentArea)) return null;
        const dir = facingCardinal(player.angle);
        const grid = getActiveGrid();
        const aC = getActiveCols(), aR = getActiveRows();
        const startCol = Math.floor(player.x / TILE), startRow = Math.floor(player.y / TILE);
        const startTile = grid[startRow]?.[startCol];
        if (!startTile || startTile.incline) return null;
        const startElevTier = startTile.elevTier || 0;
        let col = startCol, row = startRow, wallTiles = 0;
        for (let steps = 0; steps < CLIMB_MAX_WALL_TILES; steps++) {
          col += dir.x; row += dir.y;
          if (col < 0 || row < 0 || col >= aC || row >= aR) return null;
          const t = grid[row][col];
          if (!t) return null;
          if (!t.incline) {
            if (wallTiles === 0) return null; // nothing but open ground ahead
            if (isSolid(t.type)) return null;
            if ((t.elevTier || 0) === startElevTier) return null;
            return { dir, landCol: col, landRow: row, startElevTier, landElevTier: t.elevTier || 0, wallTiles };
          }
          wallTiles++;
        }
        return null;
      }

      // Scripted cliff crossing — bypasses tileSpeedAt/canPlayerOccupy entirely
      // (it deliberately walks through incline tiles that are otherwise
      // impassable) and drains no stamina. See updateClimb for the per-frame
      // staggered-hop motion.
      const CLIMB_HOP_ACTIVE_S = 0.32;
      const CLIMB_HOP_PAUSE_S  = 0.26;
      const CLIMB_HOP_BOUNCE_UNITS = 0.4;
      function startClimb(climb) {
        const grid = getActiveGrid();
        const startCol = Math.floor(player.x / TILE), startRow = Math.floor(player.y / TILE);
        const startTile = grid[startRow][startCol];
        const landTile = grid[climb.landRow][climb.landCol];
        player.climbing = true;
        player.climbElapsed = 0;
        player.climbHopCount = Math.max(3, climb.wallTiles + 1);
        player.climbStartX = player.x;
        player.climbStartY = player.y;
        player.climbEndX = (climb.landCol + 0.5) * TILE;
        player.climbEndY = (climb.landRow + 0.5) * TILE;
        player.climbSurfaceStartY = tileSurfaceYInArea(startTile, currentArea);
        player.climbSurfaceEndY = tileSurfaceYInArea(landTile, currentArea);
        player.climbSurfaceY = player.climbSurfaceStartY;
        player.climbHopBounce = 0;
        player.vx = 0; player.vy = 0;
        player.angle = Math.atan2(climb.dir.y, climb.dir.x);
        facingAngle = player.angle;
        targetAimAngle = player.angle;
        lastMoveAngle = player.angle;
      }

      function updateClimb(dt) {
        const cycle = CLIMB_HOP_ACTIVE_S + CLIMB_HOP_PAUSE_S;
        const totalDur = player.climbHopCount * cycle;
        player.climbElapsed = Math.min(player.climbElapsed + dt, totalDur);
        const hopIndex = Math.min(player.climbHopCount - 1, Math.floor(player.climbElapsed / cycle));
        const withinCycle = player.climbElapsed - hopIndex * cycle;
        const hopActive = withinCycle < CLIMB_HOP_ACTIVE_S;
        const hopLocalT = hopActive ? clamp(withinCycle / CLIMB_HOP_ACTIVE_S, 0, 1) : 1;
        const eased = 1 - Math.pow(1 - hopLocalT, 2); // quick lift-off, settles into each landing
        const overall = clamp((hopIndex + eased) / player.climbHopCount, 0, 1);

        player.x = player.climbStartX + (player.climbEndX - player.climbStartX) * overall;
        player.y = player.climbStartY + (player.climbEndY - player.climbStartY) * overall;
        player.climbSurfaceY = player.climbSurfaceStartY + (player.climbSurfaceEndY - player.climbSurfaceStartY) * overall;
        player.climbHopBounce = hopActive ? Math.sin(hopLocalT * Math.PI) * CLIMB_HOP_BOUNCE_UNITS : 0;
        player.vx = 0; player.vy = 0;

        if (player.climbElapsed >= totalDur) {
          player.x = player.climbEndX;
          player.y = player.climbEndY;
          player.climbSurfaceY = player.climbSurfaceEndY;
          player.climbHopBounce = 0;
          player.climbing = false;
        }
      }

      function angleDiff(target, current) {
        let d = target - current;
        while (d >  Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return d;
      }

      // ── Spearfishing minigame: Spear Bridge ─────────────────────
      // Ported from the spearfishing prototype's "Spear Bridge" preset only
      // (no fourSpear/ringStardew). One simplification vs. the prototype:
      // catch detection is a geometric point-to-segment distance test instead
      // of a pixel alpha-mask read. The fish and harpoon/mace render using the
      // same real assets and per-frame bone-slice "skinning" deform as the
      // prototype (see FISHING_BRIDGE_ART below). The fish still patrols a 1D
      // position mapped to a ring angle (FishBehavior.stepBase1D) and the
      // bridge mechanic (rotating aim segment → two-tap markers → spear
      // travel/retract → catch-or-panic) is otherwise numerically identical.
      const FISHING_RING = {
        cx: 160, cy: 160,
        fishRadius: 96,      // ring the fish patrols (== prototype's grooveRadius)
        outerOffset: 56,     // bridge ring sits this far outside the fish ring
        segmentSize: 18,     // degrees, width of the rotating aim segment
        sweepSpeed: 240,     // degrees/sec
        shotDuration: 0.16,
        retractDuration: 0.28,
        panicStep: 34,
        panicMax: 100,
      };
      // Escape/respawn sequence timings, ported from the prototype's fishRespawn
      // state: when panic maxes out the fish doesn't just end the round, it visibly
      // slides into the central pool, shrinks away, waits, then a freshly rolled
      // fish grows in the pool and swims back out onto the ring.
      const FISH_RESPAWN_TIMING = {
        retreatDuration: 0.72,
        shrinkDuration: 0.42,
        waitDuration: 2.15,
        growDuration: 0.68,
        enterDuration: 0.88,
      };
      function angleDiffDeg(from, to) {
        let d = (to - from) % 360;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        return d;
      }
      const FISH_CLASS_VEL_RANGE = {
        smooth:  [-0.15, 0.15],
        sinker:  [0.05, 0.55],
        floater: [-0.55, -0.05],
        dart:    [-0.55, 0.55],
        mixed:   [-0.35, 0.35],
      };
      const FISH_CLASS_RETARGET   = { smooth: 0.25, mixed: 0.55, sinker: 0.5, floater: 0.5, dart: 1.2 };
      const FISH_CLASS_SMOOTHNESS = { smooth: 0.8,  mixed: 1.4,  sinker: 1.5, floater: 1.5, dart: 4.0 };

      // Real-asset rendering for the fish silhouette + harpoon/mace sprite, ported
      // from the spearfishing prototype's ensureFishDeformCanvas/renderImageFish/
      // renderBridgeSpearSprite. The fish body+whiskers PNGs face left, same as the
      // prototype's source art, so the same flipX/rotation convention applies as-is.
      const FISHING_BRIDGE_ART = {
        imgW: 64, imgH: 40,                 // deformed fish draw size (~matches the body PNG's aspect ratio)
        deformSlices: 28, boneCount: 6,
        boneAmpScale: 0.82, whiskerBoneAmpScale: 0.3, whiskerRate: 0.38,
        flipX: -1,                          // source silhouettes face left; mirror so facing=1 points right
        spriteWidth: 46, spriteHeight: 122,  // harpoon/mace sprite box (preserveAspectRatio keeps the real PNG shape)
        spriteRotationOffset: 90,           // the PNG's business end is at the bottom, not the top
        ropeAttachBack: 23, spearAttachFront: 10,
        ropeSag: 0.1,
        maceSpinRateDeg: 9720,              // ~27 spins/sec while the mace is outbound
      };

      let fishBodySpriteImage = null, fishWhiskersSpriteImage = null;
      let harpoonSpearSpriteImage = null, harpoonMaceSpriteImage = null;
      function loadFishSprite(src, onOk) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          onOk(img);
          window.__farmLog?.(`sprite loaded OK: ${src} (${img.naturalWidth}x${img.naturalHeight})`, 'fish');
        };
        img.onerror = (ev) => {
          window.__farmLog?.(`sprite FAILED to load: ${src}`, 'fish');
        };
        img.src = src;
        return img;
      }
      loadFishSprite('assets/hud/fish_silhouette-body.png', (img) => { fishBodySpriteImage = img; });
      loadFishSprite('assets/hud/fish_silhouette-whiskers.png', (img) => { fishWhiskersSpriteImage = img; });
      loadFishSprite('assets/toolsprites/harpoon_fishingspear.png', (img) => { harpoonSpearSpriteImage = img; });
      loadFishSprite('assets/toolsprites/harpoon_fishingmace.png', (img) => { harpoonMaceSpriteImage = img; });

      let fishDeformCanvas = null, fishDeformCtx = null;
      function ensureFishDeformCanvas(width, height) {
        const w = Math.max(48, Math.round(width));
        const h = Math.max(24, Math.round(height));
        if (!fishDeformCanvas) { fishDeformCanvas = document.createElement('canvas'); fishDeformCtx = fishDeformCanvas.getContext('2d'); }
        if (fishDeformCanvas.width !== w || fishDeformCanvas.height !== h) { fishDeformCanvas.width = w; fishDeformCanvas.height = h; }
        return { canvas: fishDeformCanvas, ctx: fishDeformCtx, w, h };
      }

      // Small spline-skeleton "bone" offsets sampled across deformSlices vertical strips,
      // tapered toward the head/tail so the deform bends most in the middle of the body.
      function buildFishBoneOffsets(sliceCount, amp, phase, rateScale) {
        const boneCount = FISHING_BRIDGE_ART.boneCount;
        const bones = [];
        for (let i = 0; i < boneCount; i++) {
          const t01 = boneCount === 1 ? 0.5 : i / (boneCount - 1);
          const taper = Math.sin(Math.PI * t01);
          const leadLag = t01 * Math.PI * 2.15;
          bones.push(Math.sin(phase * rateScale + leadLag) * amp * taper);
        }
        const offsets = [];
        for (let i = 0; i < sliceCount; i++) {
          const t01 = sliceCount === 1 ? 0.5 : i / (sliceCount - 1);
          const scaled = t01 * (bones.length - 1);
          const left = Math.max(0, Math.min(bones.length - 2, Math.floor(scaled)));
          const local = scaled - left;
          offsets.push(bones[left] + (bones[left + 1] - bones[left]) * local);
        }
        return offsets;
      }

      function drawFishImageAlongBones(ctx, image, canvasW, canvasH, drawW, drawH, offsets, alpha) {
        if (!image || !image.naturalWidth || !image.naturalHeight) return;
        const sliceCount = Math.max(4, offsets.length || 4);
        const srcSliceW = image.naturalWidth / sliceCount;
        const dstSliceW = drawW / sliceCount;
        const startX = (canvasW - drawW) * 0.5;
        const startY = (canvasH - drawH) * 0.5;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.imageSmoothingEnabled = true;
        for (let i = 0; i < sliceCount; i++) {
          const nextOffset = offsets[Math.min(offsets.length - 1, i + 1)] ?? offsets[i] ?? 0;
          const offset = offsets[i] || 0;
          const shear = clamp((nextOffset - offset) / Math.max(1, dstSliceW), -0.32, 0.32);
          const sx = i * srcSliceW;
          const dx = startX + i * dstSliceW;
          const dy = startY + offset;
          ctx.save();
          ctx.beginPath();
          ctx.rect(dx - 1, 0, dstSliceW + 2, canvasH);
          ctx.clip();
          ctx.transform(1, shear, 0, 1, 0, 0);
          ctx.drawImage(image, sx, 0, srcSliceW + 1, image.naturalHeight, dx, dy - shear * dx, dstSliceW + 1.5, drawH);
          ctx.restore();
        }
        ctx.restore();
      }

      // toDataURL() is a synchronous PNG encode — doing it every animation frame
      // (60/sec) is what was tripping the browser's "requestAnimationFrame handler
      // took Nms" violation while fishing. The deform itself still redraws every
      // frame (cheap drawImage calls), but the expensive re-encode to a data URL
      // only happens a few times a second; the SVG <image> keeps showing the last
      // encoded frame in between, which reads as smooth at this swim speed.
      let _fishDeformUrlCache = null;
      let _fishDeformUrlCacheAt = -Infinity;
      const FISH_DEFORM_REENCODE_INTERVAL = 1 / 12; // seconds
      let _fishDeformLastFailReason = null;
      function renderFishDeformedTexture(fm) {
        if (!fishBodySpriteImage || !fishBodySpriteImage.naturalWidth) {
          if (_fishDeformLastFailReason !== 'noimg') {
            _fishDeformLastFailReason = 'noimg';
            window.__farmLog?.('fish render: body sprite not loaded yet, skipping draw', 'fish');
          }
          return null;
        }
        const art = FISHING_BRIDGE_ART;
        const pad = Math.ceil(art.imgH * 0.45);
        const targetW = Math.ceil(art.imgW + pad * 2);
        const targetH = Math.ceil(art.imgH + pad * 2);
        const { canvas, ctx, w, h } = ensureFishDeformCanvas(targetW, targetH);
        ctx.clearRect(0, 0, w, h);

        const phase = fm.fishAnimT * 7.5 + fm.fish.angle * 0.025;
        const bodyAmp = Math.max(2, art.imgH * 0.075 * art.boneAmpScale);
        const bodyOffsets = buildFishBoneOffsets(art.deformSlices, bodyAmp, phase, 1);
        const whiskerOffsets = buildFishBoneOffsets(art.deformSlices, bodyAmp * art.whiskerBoneAmpScale, phase + 0.85, art.whiskerRate);

        drawFishImageAlongBones(ctx, fishBodySpriteImage, w, h, art.imgW, art.imgH, bodyOffsets, 1);
        if (fishWhiskersSpriteImage && fishWhiskersSpriteImage.naturalWidth) {
          drawFishImageAlongBones(ctx, fishWhiskersSpriteImage, w, h, art.imgW, art.imgH, whiskerOffsets, 0.95);
        }
        if (_fishDeformUrlCache && fm.fishAnimT - _fishDeformUrlCacheAt < FISH_DEFORM_REENCODE_INTERVAL) {
          return { url: _fishDeformUrlCache, w, h };
        }
        try {
          _fishDeformUrlCache = canvas.toDataURL('image/png');
          _fishDeformUrlCacheAt = fm.fishAnimT;
          _fishDeformLastFailReason = null;
          return { url: _fishDeformUrlCache, w, h };
        } catch (err) {
          if (_fishDeformLastFailReason !== 'tainted') {
            _fishDeformLastFailReason = 'tainted';
            window.__farmLog?.(`fish render: canvas.toDataURL() threw (${err.name}: ${err.message}) — canvas likely tainted by a cross-origin sprite load`, 'fish');
          }
          return null;
        }
      }

      let fishingMinigame = null; // non-null while the spear-bridge overlay is open
      let fishingEls = null;      // cached persistent DOM refs, rebuilt each time the overlay opens
      const fishingOverlayEl = document.getElementById('fishingOverlay');

      function currentFishZoneKey() {
        if (currentArea === 'farm') return 'farm';
        if (currentArea === 'town') return 'town';
        if (currentArea === 'map_northern_cliffs') return 'northernCliffs';
        if (currentArea === 'map_southern_cloud_forest') return 'cloudForest';
        return null;
      }

      function fishingTimeOfDay() {
        const h = getHour();
        if (h < 8)  return 'dawn';
        if (h < 17) return 'day';
        if (h < 20) return 'dusk';
        return 'night';
      }

      function pickFishForCurrentZone() {
        const zoneKey = currentFishZoneKey();
        if (!zoneKey) return null;
        const list = FISH_DEFS[zoneKey] || [];
        if (!list.length) return null;
        const season = currentSeason().name;
        const tod = fishingTimeOfDay();
        let pool = list.filter(f =>
          (f.seasons === 'any' || f.seasons.includes(season)) &&
          (f.timesOfDay === 'any' || f.timesOfDay.includes(tod)));
        if (!pool.length) pool = list;
        const rarityWeight = { common: 6, uncommon: 3, rare: 1 };
        const weights = pool.map(f => rarityWeight[f.rarity] || 1);
        let r = Math.random() * weights.reduce((a, b) => a + b, 0);
        for (let i = 0; i < pool.length; i++) {
          r -= weights[i];
          if (r <= 0) return { fish: pool[i], zoneKey };
        }
        return { fish: pool[pool.length - 1], zoneKey };
      }

      function fishPickTargetVel(fm) {
        const [min, max] = FISH_CLASS_VEL_RANGE[fm.fishClass] || FISH_CLASS_VEL_RANGE.mixed;
        const d = fm.difficulty / 100;
        fm.fish.targetVel = (min + Math.random() * (max - min)) * (0.6 + d * 0.9);
      }

      function fishStartTurnaround(fm, nextDir) {
        const f = fm.fish;
        if (!nextDir || nextDir === f.moveDir) return;
        f.turning = true;
        f.pendingMoveDir = nextDir;
        f.turnProgress = 0;
      }

      function fishUpdateTurnaround(fm, dt) {
        const f = fm.fish;
        if (!f.turning) return;
        f.turnProgress = clamp(f.turnProgress + dt / 0.24, 0, 1);
        f.localFacingScale = f.moveDir * Math.cos(Math.PI * f.turnProgress);
        if (f.turnProgress >= 1) {
          f.turning = false;
          f.moveDir = f.pendingMoveDir || -f.moveDir;
          f.turnProgress = 0;
          f.localFacingScale = f.moveDir;
          f.vel = Math.abs(f.vel) * f.moveDir * 0.35;
          f.targetVel = Math.abs(f.targetVel) * f.moveDir;
        }
      }

      function fishStepMotion(fm, dt) {
        const f = fm.fish;
        const cls = fm.fishClass;
        const retargetChance = (FISH_CLASS_RETARGET[cls] ?? 0.55) * dt;
        const smoothness = FISH_CLASS_SMOOTHNESS[cls] ?? 1.4;
        const d = fm.difficulty / 100;

        if (Math.random() < retargetChance) fishPickTargetVel(fm);

        const desiredSource = Math.abs(f.targetVel) > 0.01 ? f.targetVel : (Math.abs(f.vel) > 0.01 ? f.vel : f.moveDir);
        const desiredDir = desiredSource < 0 ? -1 : 1;
        if (!f.turning && desiredDir !== f.moveDir) fishStartTurnaround(fm, desiredDir);
        fishUpdateTurnaround(fm, dt);

        let appliedTargetVel = f.turning ? Math.abs(f.targetVel) * f.moveDir : f.targetVel;
        f.vel += (appliedTargetVel - f.vel) * Math.min(1, dt * (2.5 + smoothness * 2.2));
        if (cls === 'sinker')  f.vel += 0.08 * dt * (0.5 + d);
        if (cls === 'floater') f.vel -= 0.08 * dt * (0.5 + d);
        if (f.turning) f.vel = Math.abs(f.vel) * f.moveDir;

        f.pos = clamp(f.pos + f.vel * dt, 0, 1);
        if (f.pos <= 0.02) {
          f.pos = 0.02;
          if (!f.turning) {
            f.vel = Math.abs(f.vel) * 0.18;
            f.targetVel = Math.max(0.04, Math.abs(f.targetVel));
            if (f.moveDir < 0) fishStartTurnaround(fm, 1);
          }
        } else if (f.pos >= 0.98) {
          f.pos = 0.98;
          if (!f.turning) {
            f.vel = -Math.abs(f.vel) * 0.18;
            f.targetVel = -Math.max(0.04, Math.abs(f.targetVel));
            if (f.moveDir > 0) fishStartTurnaround(fm, -1);
          }
        }
        f.angle = (f.pos * 359) % 360;
      }

      function fishingPolarToXY(angleDeg, radius) {
        const rad = (angleDeg - 90) * Math.PI / 180; // 0deg = top, matches prototype orientation
        return { x: FISHING_RING.cx + Math.cos(rad) * radius, y: FISHING_RING.cy + Math.sin(rad) * radius };
      }

      function fishingDistPointToSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        const len2 = dx * dx + dy * dy;
        if (len2 <= 0.0001) return Math.hypot(px - x1, py - y1);
        const t = clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1);
        return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
      }

      function startFishingMinigame() {
        const picked = pickFishForCurrentZone();
        if (!picked) { showToast('No fish here.', false); return; }
        const { fish, zoneKey } = picked;
        // Anchor the floating ring over the actual river tile being fished, so it
        // tracks the live 3D scene's camera angle instead of sitting in a fixed
        // modal position (see updateFishingRingScreenPosition/worldToOverlay).
        const reticle = getReticleTile();
        const reticleTile = getActiveTileAt(reticle.col, reticle.row);
        const anchorWorld = {
          x: reticle.col + 0.5,
          z: reticle.row + 0.5,
          y: tileSurfaceY(reticleTile.type) + 0.35,
        };
        fishingMinigame = {
          active: true,
          fishDef: fish,
          zoneKey,
          difficulty: fish.difficulty,
          fishClass: fish.fishClass,
          fishAnimT: 0,
          anchorWorld,
          fish: {
            pos: Math.random(), vel: 0, targetVel: 0, angle: 0,
            moveDir: 1, pendingMoveDir: 1, turning: false, turnProgress: 0, localFacingScale: 1,
          },
          bridge: {
            angle: 0, direction: 1, segmentSize: FISHING_RING.segmentSize, speed: FISHING_RING.sweepSpeed,
            markerA: null, markerB: null, spearActive: false, lineA: null, lineB: null,
            shotTimer: 0, retractTimer: 0, tipX: 0, tipY: 0, prevTipX: 0, prevTipY: 0, caughtFish: false,
            weaponSpinDeg: 0, frozenWeaponAngleDeg: 0,
          },
          panic: 0,
          resolved: false,
          resultTimer: 0,
          message: 'Tap Fire to drop the first marker.',
          messageType: '',
          respawn: {
            active: false, phase: 'idle', timer: 0, scale: 1,
            startAngle: 0, startRadius: FISHING_RING.fishRadius,
            centerAngle: 0, centerRadius: 0,
            enterStartAngle: 0, enterStartRadius: 0, enterTargetAngle: 0,
          },
        };
        fishPickTargetVel(fishingMinigame);
        _fishDeformUrlCache = null;
        _fishDeformUrlCacheAt = -Infinity;
        window.__farmLog?.(`fishing started: zone=${zoneKey} fish=${fish.key} anchor=(${anchorWorld.x.toFixed(2)},${anchorWorld.y.toFixed(2)},${anchorWorld.z.toFixed(2)}) bodyImgLoaded=${!!(fishBodySpriteImage && fishBodySpriteImage.naturalWidth)}`);
        // World time/NPCs/weather keep running during the minigame — only
        // player movement is suspended (see the guard in updateMovement).
        renderFishingOverlay();
        fishingOverlayEl.classList.add('open');

        // Swap to the "fishing" camera mode (fixed diagonal offset, matching the
        // (HA)SpearFishingMinigameV2 prototype's cube/river framing) and track the
        // fished water tile instead of the player while the minigame is open.
        _prevCameraMode = activeCameraMode;
        _prevCameraTarget = activeCameraTarget;
        activeCameraMode = 'fishing';
        activeCameraTarget = { position: new THREE.Vector3(anchorWorld.x, anchorWorld.y, anchorWorld.z) };
      }

      function closeFishingMinigame() {
        if (!fishingMinigame) return;
        fishingMinigame = null;
        fishingOverlayEl.classList.remove('open');
        fishingOverlayEl.innerHTML = '';
        fishingEls = null;
        if (_prevCameraMode !== null) { activeCameraMode = _prevCameraMode; _prevCameraMode = null; }
        activeCameraTarget = _prevCameraTarget;
        _prevCameraTarget = null;
      }

      function fireFishingBridge() {
        const fm = fishingMinigame;
        if (!fm || fm.resolved || fm.respawn.active || fm.bridge.spearActive) return;
        const b = fm.bridge;
        const currentAngle = b.angle;
        if (b.markerA == null) {
          b.markerA = currentAngle;
          b.markerB = null;
          fm.message = 'First marker placed. Tap Fire again.';
          fm.messageType = '';
          return;
        }
        b.markerB = currentAngle;
        b.lineA = b.markerA;
        b.lineB = b.markerB;
        b.spearActive = true;
        b.shotTimer = 0;
        b.retractTimer = 0;
        b.caughtFish = false;
        const outerRadius = FISHING_RING.fishRadius + FISHING_RING.outerOffset;
        const a = fishingPolarToXY(b.lineA, outerRadius);
        b.tipX = b.prevTipX = a.x;
        b.tipY = b.prevTipY = a.y;
        b.direction *= -1;
        b.markerA = null;
        b.markerB = null;
        fm.message = 'Spear thrown!';
        fm.messageType = '';

        // Cosmetic 3D-world throw: reuse the hoe/chop swing arc (raise → slam) but
        // fly the held harpoon mesh out to the fishing anchor mid-slam instead of
        // slamming it down at the player's feet, then ease it back to the hand.
        // Duration must stay under the 2D ring's shot+retract window (~0.44s) so a
        // repeat cast can't restart the swing while the mesh is still mid-flight.
        toolSwingDur = 0.42;
        toolSwingT = toolSwingDur;
        strikeFired = true; // fishing has no pendingAction to fire on strike
        fishThrowActive = true;
      }

      function fishingTryTipCatch(fm) {
        const b = fm.bridge;
        if (b.caughtFish || !b.spearActive) return false;
        const fishPos = fishingPolarToXY(fm.fish.angle, FISHING_RING.fishRadius);
        const colliderRadius = 14;
        const dist = fishingDistPointToSegment(fishPos.x, fishPos.y, b.prevTipX, b.prevTipY, b.tipX, b.tipY);
        if (dist <= colliderRadius) { b.caughtFish = true; return true; }
        return false;
      }

      function resolveFishingRound(fm, caught) {
        if (caught) {
          fm.resolved = true;
          fm.resultTimer = 1.1;
          inventory[fm.fishDef.key] = Math.min(99, (inventory[fm.fishDef.key] || 0) + 1);
          fm.message = `Caught a ${fm.fishDef.label}! ${fm.fishDef.icon}`;
          fm.messageType = 'good';
          lastActionMessage = fm.message;
          return;
        }
        beginFishEscapeRespawn(fm);
      }

      // Panic maxed out without a catch: the current fish escapes into the
      // central pool instead of ending the round outright. A new fish is
      // rolled mid-animation and swims back out so the player keeps fishing.
      function beginFishEscapeRespawn(fm) {
        const r = fm.respawn;
        r.active = true;
        r.phase = 'retreat';
        r.timer = 0;
        r.startAngle = fm.fish.angle;
        r.startRadius = FISHING_RING.fishRadius;
        r.centerAngle = r.startAngle;
        r.centerRadius = 72 + Math.random() * 26;
        r.scale = 1;
        fm.message = 'Fish fled into the pool.';
        fm.messageType = 'bad';
      }

      function respawnNextFish(fm) {
        const picked = pickFishForCurrentZone();
        const fish = picked ? picked.fish : fm.fishDef;
        fm.fishDef = fish;
        fm.difficulty = fish.difficulty;
        fm.fishClass = fish.fishClass;
        fm.fish.pos = Math.random();
        fm.fish.vel = 0;
        fm.fish.targetVel = 0;
        fm.fish.moveDir = 1;
        fm.fish.pendingMoveDir = 1;
        fm.fish.turning = false;
        fm.fish.turnProgress = 0;
        fm.fish.localFacingScale = 1;
        fishPickTargetVel(fm);
        fm.panic = 0;
        const r = fm.respawn;
        r.enterStartAngle = r.centerAngle;
        r.enterStartRadius = r.centerRadius;
        r.enterTargetAngle = fm.fish.angle;
      }

      function beginFishPoolEnter(fm) {
        const r = fm.respawn;
        r.phase = 'enter';
        r.timer = 0;
        r.scale = 1;
        r.enterStartAngle = r.centerAngle;
        r.enterStartRadius = r.centerRadius;
        r.enterTargetAngle = fm.fish.angle;
        fm.message = 'New fish is swimming back to the ring.';
        fm.messageType = '';
      }

      function finishFishPoolEnter(fm) {
        const r = fm.respawn;
        r.active = false;
        r.phase = 'idle';
        r.timer = 0;
        r.scale = 1;
        fm.message = 'New fish entered. Tap Fire to drop the first marker.';
        fm.messageType = '';
      }

      function updateFishRespawnAnimation(fm, dt) {
        const r = fm.respawn;
        const T = FISH_RESPAWN_TIMING;
        r.timer += dt;
        if (r.phase === 'retreat' && r.timer >= T.retreatDuration) {
          r.phase = 'shrink'; r.timer = 0; r.scale = 1;
        } else if (r.phase === 'shrink' && r.timer >= T.shrinkDuration) {
          r.phase = 'wait'; r.timer = 0; r.scale = 0;
        } else if (r.phase === 'wait' && r.timer >= T.waitDuration) {
          r.phase = 'grow'; r.timer = 0; r.scale = 0;
          respawnNextFish(fm);
        } else if (r.phase === 'grow' && r.timer >= T.growDuration) {
          beginFishPoolEnter(fm);
        } else if (r.phase === 'enter') {
          fishStepMotion(fm, dt);
          r.enterTargetAngle = fm.fish.angle;
          if (r.timer >= T.enterDuration) finishFishPoolEnter(fm);
        }
      }

      // Visual-only pose during the escape/respawn sequence: where to draw the
      // fish (pool center vs sliding/growing) and at what scale. Returns null
      // once the sequence is over so normal ring rendering takes over again.
      function getRespawnFishPose(fm) {
        const r = fm.respawn;
        if (!r.active) return null;
        const T = FISH_RESPAWN_TIMING;
        if (r.phase === 'retreat') {
          const t = clamp(r.timer / T.retreatDuration, 0, 1);
          const angle = r.startAngle + angleDiffDeg(r.startAngle, r.centerAngle) * t;
          const radius = r.startRadius + (r.centerRadius - r.startRadius) * t;
          return { angle, radius, scale: 1 };
        }
        if (r.phase === 'shrink') {
          const t = clamp(r.timer / T.shrinkDuration, 0, 1);
          return { angle: r.centerAngle, radius: r.centerRadius, scale: Math.max(0, 1 - t) };
        }
        if (r.phase === 'wait') {
          return { angle: r.centerAngle, radius: r.centerRadius, scale: 0 };
        }
        if (r.phase === 'grow') {
          const t = clamp(r.timer / T.growDuration, 0, 1);
          return { angle: r.centerAngle, radius: r.centerRadius, scale: t };
        }
        if (r.phase === 'enter') {
          const t = clamp(r.timer / T.enterDuration, 0, 1);
          const angle = r.enterStartAngle + angleDiffDeg(r.enterStartAngle, r.enterTargetAngle) * t;
          const radius = r.enterStartRadius + (FISHING_RING.fishRadius - r.enterStartRadius) * t;
          return { angle, radius, scale: 1 };
        }
        return null;
      }

      function updateFishingMinigame(dt) {
        const fm = fishingMinigame;
        if (!fm) return;
        if (fm.resolved) {
          fm.resultTimer -= dt;
          if (fm.resultTimer <= 0) { closeFishingMinigame(); return; }
          renderFishingOverlay();
          return;
        }

        if (fm.respawn.active) {
          fm.fishAnimT += dt;
          updateFishRespawnAnimation(fm, dt);
          renderFishingOverlay();
          return;
        }

        fm.fishAnimT += dt;
        fishStepMotion(fm, dt);

        const b = fm.bridge;
        b.angle = (b.angle + b.speed * b.direction * dt + 360) % 360;

        if (b.spearActive) {
          const outerRadius = FISHING_RING.fishRadius + FISHING_RING.outerOffset;
          const a = fishingPolarToXY(b.lineA, outerRadius);
          const bPt = fishingPolarToXY(b.lineB, outerRadius);
          b.prevTipX = b.tipX;
          b.prevTipY = b.tipY;

          if (b.shotTimer < FISHING_RING.shotDuration) {
            b.weaponSpinDeg = (b.weaponSpinDeg + FISHING_BRIDGE_ART.maceSpinRateDeg * dt) % 360;
            b.frozenWeaponAngleDeg = Math.atan2(bPt.y - a.y, bPt.x - a.x) * 180 / Math.PI + FISHING_BRIDGE_ART.spriteRotationOffset;
            b.shotTimer = Math.min(FISHING_RING.shotDuration, b.shotTimer + dt);
            const t = b.shotTimer / FISHING_RING.shotDuration;
            b.tipX = a.x + (bPt.x - a.x) * t;
            b.tipY = a.y + (bPt.y - a.y) * t;
            fishingTryTipCatch(fm);
          } else if (b.retractTimer < FISHING_RING.retractDuration) {
            b.weaponSpinDeg = 0;
            b.frozenWeaponAngleDeg = Math.atan2(bPt.y - a.y, bPt.x - a.x) * 180 / Math.PI + FISHING_BRIDGE_ART.spriteRotationOffset;
            b.retractTimer = Math.min(FISHING_RING.retractDuration, b.retractTimer + dt);
            const t = b.retractTimer / FISHING_RING.retractDuration;
            b.tipX = bPt.x + (a.x - bPt.x) * t;
            b.tipY = bPt.y + (a.y - bPt.y) * t;
          } else {
            if (b.caughtFish) {
              resolveFishingRound(fm, true);
            } else {
              fm.panic = Math.min(FISHING_RING.panicMax, fm.panic + FISHING_RING.panicStep);
              if (fm.panic >= FISHING_RING.panicMax) {
                resolveFishingRound(fm, false);
              } else {
                fm.message = 'Missed! Panic rising.';
                fm.messageType = 'bad';
              }
            }
            b.spearActive = false;
            b.lineA = null;
            b.lineB = null;
            b.shotTimer = 0;
            b.retractTimer = 0;
            b.caughtFish = false;
          }
        }

        renderFishingOverlay();
      }

      // Builds the static overlay markup once per minigame session; per-frame updates
      // only touch attributes on the cached nodes below (renderFishingOverlay), so the
      // deformed-fish canvas/dataURL churn each frame doesn't force a full innerHTML
      // rebuild + listener rebind every tick.
      function buildFishingOverlayDom(fm) {
        const R = FISHING_RING;
        const outerRadius = R.fishRadius + R.outerOffset;
        fishingOverlayEl.innerHTML = `
          <div class="fish-ring-wrap" id="fishRingWrap">
            <svg viewBox="0 0 ${R.cx * 2} ${R.cy * 2}">
              <circle cx="${R.cx}" cy="${R.cy}" r="${R.fishRadius}" fill="none" stroke="rgba(127,232,154,0.4)" stroke-width="2"/>
              <circle cx="${R.cx}" cy="${R.cy}" r="${outerRadius}" fill="none" stroke="rgba(255,255,255,0.32)" stroke-width="2"/>
              <path id="fishSegArc" fill="none" stroke="#f9e28a" stroke-width="6" stroke-linecap="round"/>
              <circle id="fishMarkerA" r="5" fill="#ff8060" opacity="0"/>
              <circle id="fishMarkerB" r="5" fill="#ff8060" opacity="0"/>
              <path id="fishSpearRope" fill="none" stroke="#cbb892" stroke-width="2" opacity="0"/>
              <g id="fishSpearSpriteWrap" opacity="0"><image id="fishSpearImage" preserveAspectRatio="xMidYMid meet"/></g>
              <g id="fishImageRig" opacity="0"><g id="fishImageTransform"><image id="fishDeformedImage" preserveAspectRatio="none"/></g></g>
            </svg>
          </div>
          <div class="fish-dock">
            <div class="fish-title">${FISH_ZONE_LABELS[fm.zoneKey]} — Spearfishing</div>
            <div class="fish-hint">Tap Fire once to drop marker 1, again for marker 2. The spear flies the chord between them — line it up with the fish.</div>
            <div class="fish-status" id="fishStatus"></div>
            <div class="fish-panic-wrap"><div class="fish-panic-fill" id="fishPanicFill"></div></div>
            <button class="fish-fire-btn" id="fishFireBtn">Fire (Space)</button>
            <button class="fish-cancel-btn" id="fishCancelBtn">Give up</button>
          </div>`;

        fishingEls = {
          ringWrap: document.getElementById('fishRingWrap'),
          segArc: document.getElementById('fishSegArc'),
          markerA: document.getElementById('fishMarkerA'),
          markerB: document.getElementById('fishMarkerB'),
          spearRope: document.getElementById('fishSpearRope'),
          spearSpriteWrap: document.getElementById('fishSpearSpriteWrap'),
          spearImage: document.getElementById('fishSpearImage'),
          fishImageRig: document.getElementById('fishImageRig'),
          fishImageTransform: document.getElementById('fishImageTransform'),
          fishDeformedImage: document.getElementById('fishDeformedImage'),
          status: document.getElementById('fishStatus'),
          panicFill: document.getElementById('fishPanicFill'),
          dock: document.querySelector('.fish-dock'),
        };

        const fireBtn = document.getElementById('fishFireBtn');
        if (fireBtn) fireBtn.addEventListener('pointerup', (e) => { e.stopPropagation(); fireFishingBridge(); });
        const cancelBtn = document.getElementById('fishCancelBtn');
        if (cancelBtn) cancelBtn.addEventListener('pointerup', (e) => { e.stopPropagation(); closeFishingMinigame(); });
      }

      // Ported from the prototype's renderBridgeSpearSprite: positions the real
      // harpoon/mace PNG (business end at the image's bottom) rotated along the
      // flight chord, with a quadratic-bezier rope back to the launch point, and
      // (mace only) a rapid spin while outbound that freezes once retracting.
      function renderFishingSpearSprite(startPoint, endPoint) {
        const art = FISHING_BRIDGE_ART;
        const useMace = equipmentSlots.harpoon === 'fishingmace';
        const spriteImg = useMace ? harpoonMaceSpriteImage : harpoonSpearSpriteImage;
        const dx = endPoint.x - startPoint.x, dy = endPoint.y - startPoint.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const nx = -uy, ny = ux;
        const ropeEndX = useMace ? endPoint.x : endPoint.x - ux * art.ropeAttachBack;
        const ropeEndY = useMace ? endPoint.y : endPoint.y - uy * art.ropeAttachBack;
        const sag = Math.min(22, len * art.ropeSag);
        const ctrlX = (startPoint.x + ropeEndX) * 0.5 + nx * sag;
        const ctrlY = (startPoint.y + ropeEndY) * 0.5 + ny * sag;
        fishingEls.spearRope.setAttribute('d', `M ${startPoint.x.toFixed(2)} ${startPoint.y.toFixed(2)} Q ${ctrlX.toFixed(2)} ${ctrlY.toFixed(2)} ${ropeEndX.toFixed(2)} ${ropeEndY.toFixed(2)}`);
        fishingEls.spearRope.setAttribute('opacity', '1');

        if (!spriteImg || !spriteImg.naturalWidth) { fishingEls.spearSpriteWrap.setAttribute('opacity', '0'); return; }

        const spriteW = art.spriteWidth, spriteH = art.spriteHeight, front = art.spearAttachFront;
        fishingEls.spearImage.setAttribute('href', spriteImg.src);
        fishingEls.spearImage.setAttribute('x', (-spriteW * 0.5).toFixed(2));
        fishingEls.spearImage.setAttribute('y', (useMace ? -spriteH * 0.5 : -front).toFixed(2));
        fishingEls.spearImage.setAttribute('width', spriteW.toFixed(2));
        fishingEls.spearImage.setAttribute('height', spriteH.toFixed(2));
        fishingEls.spearImage.setAttribute('transform', 'scale(1 -1)');

        const baseAngleDeg = Math.atan2(dy, dx) * 180 / Math.PI + art.spriteRotationOffset;
        const b = fishingMinigame.bridge;
        const isOutbound = b.spearActive && b.shotTimer < FISHING_RING.shotDuration;
        let angleDeg = baseAngleDeg;
        if (useMace) {
          if (isOutbound) angleDeg = baseAngleDeg + (b.weaponSpinDeg || 0);
          else if (Number.isFinite(b.frozenWeaponAngleDeg)) angleDeg = b.frozenWeaponAngleDeg;
        }
        fishingEls.spearSpriteWrap.setAttribute('transform', `translate(${endPoint.x.toFixed(2)} ${endPoint.y.toFixed(2)}) rotate(${angleDeg.toFixed(2)})`);
        fishingEls.spearSpriteWrap.setAttribute('opacity', '1');
      }

      // Ported from the prototype's renderImageFish: positions the deformed/skinned
      // fish silhouette (see renderFishDeformedTexture) at its ring point, rotated to
      // the ring angle and mirrored by localFacingScale for left/right turnarounds.
      function renderFishingImageFish(fm) {
        const pose = getRespawnFishPose(fm);
        if (pose && pose.scale <= 0.01) {
          fishingEls.fishImageRig.setAttribute('opacity', '0');
          return;
        }
        const renderAngle = pose ? pose.angle : fm.fish.angle;
        const renderRadius = pose ? pose.radius : FISHING_RING.fishRadius;
        const renderScale = pose ? pose.scale : 1;
        const fishPt = fishingPolarToXY(renderAngle, renderRadius);
        const deform = renderFishDeformedTexture(fm);
        // Only log on a state change (loaded vs. not), so the debug panel gets one
        // entry per session instead of one per frame at 60fps.
        if (fm._pngLogState !== !!deform) {
          fm._pngLogState = !!deform;
          window.__farmLog?.(
            `fish png render: ${deform ? 'OK (' + deform.w.toFixed(0) + 'x' + deform.h.toFixed(0) + ')' : 'FAILED'} ` +
            `bodyImgLoaded=${!!(fishBodySpriteImage && fishBodySpriteImage.naturalWidth)}`,
            deform ? 'info' : 'warn'
          );
        }
        if (!deform) {
          fishingEls.fishImageRig.setAttribute('opacity', '0');
          return;
        }

        const art = FISHING_BRIDGE_ART;
        const requested = fm.fish.localFacingScale;
        const localFacingScale = Math.abs(requested) < 0.035 ? 0.035 * Math.sign(requested || 1) : requested;
        const scaleX = art.flipX * localFacingScale;

        const w = deform.w * renderScale, h = deform.h * renderScale;
        fishingEls.fishImageRig.setAttribute('opacity', '1');
        fishingEls.fishImageRig.setAttribute('transform', `translate(${fishPt.x.toFixed(2)} ${fishPt.y.toFixed(2)})`);
        fishingEls.fishImageTransform.setAttribute('transform', `rotate(${renderAngle.toFixed(2)}) scale(${scaleX.toFixed(4)} 1)`);
        fishingEls.fishDeformedImage.setAttribute('href', deform.url);
        fishingEls.fishDeformedImage.setAttribute('x', (-w / 2).toFixed(2));
        fishingEls.fishDeformedImage.setAttribute('y', (-h / 2).toFixed(2));
        fishingEls.fishDeformedImage.setAttribute('width', w.toFixed(2));
        fishingEls.fishDeformedImage.setAttribute('height', h.toFixed(2));
      }

      // Floats the ring over the live 3D scene at the river tile's projected screen
      // position instead of centering it in a modal — same camera-angle-tracking
      // intent as the prototype's backdrop demo (cube player + river prism).
      function updateFishingRingScreenPosition(fm) {
        if (!fishingEls || !fm.anchorWorld) return;
        const proj = worldToOverlay(fm.anchorWorld.x, fm.anchorWorld.y, fm.anchorWorld.z);
        if (!proj.visible) return;
        const halfRing = 160; // matches the ring-wrap's max 320px size
        const rect = _threeRect;
        const left = clamp(proj.x, halfRing, Math.max(halfRing, rect.width - halfRing));
        const top = clamp(proj.y, halfRing, Math.max(halfRing, rect.height - halfRing));
        fishingEls.ringWrap.style.left = (rect.left + left) + 'px';
        fishingEls.ringWrap.style.top = (rect.top + top) + 'px';
      }

      // Keeps the title/hint/status/panic dock parked just to the left of the
      // player avatar on screen, instead of pinned to the bottom of the page,
      // so it reads as attached to the character doing the fishing.
      function updateFishingDockScreenPosition() {
        if (!fishingEls?.dock || !playerMesh) return;
        const proj = worldToOverlay(playerMesh.position.x, playerMesh.position.y + 0.6, playerMesh.position.z);
        if (!proj.visible) return;
        const dockGap = 105;
        const dockWidth = 105; // keeps the dock's left edge from running off-screen
        const rect = _threeRect;
        const left = clamp(proj.x - dockGap, dockWidth, rect.width);
        const top = clamp(proj.y, 0, rect.height);
        fishingEls.dock.style.left = (rect.left + left) + 'px';
        fishingEls.dock.style.top = (rect.top + top) + 'px';
      }

      function renderFishingOverlay() {
        const fm = fishingMinigame;
        if (!fm) return;
        if (!fishingEls) buildFishingOverlayDom(fm);
        updateFishingRingScreenPosition(fm);
        updateFishingDockScreenPosition();

        const R = FISHING_RING;
        const outerRadius = R.fishRadius + R.outerOffset;
        const half = R.segmentSize / 2;

        fishingEls.segArc.setAttribute('d', describeFishingArc(outerRadius, fm.bridge.angle - half, fm.bridge.angle + half));

        if (fm.bridge.markerA != null) {
          const p = fishingPolarToXY(fm.bridge.markerA, outerRadius);
          fishingEls.markerA.setAttribute('cx', p.x.toFixed(1));
          fishingEls.markerA.setAttribute('cy', p.y.toFixed(1));
          fishingEls.markerA.setAttribute('opacity', '1');
        } else {
          fishingEls.markerA.setAttribute('opacity', '0');
        }
        if (fm.bridge.markerB != null) {
          const p = fishingPolarToXY(fm.bridge.markerB, outerRadius);
          fishingEls.markerB.setAttribute('cx', p.x.toFixed(1));
          fishingEls.markerB.setAttribute('cy', p.y.toFixed(1));
          fishingEls.markerB.setAttribute('opacity', '1');
        } else {
          fishingEls.markerB.setAttribute('opacity', '0');
        }

        if (fm.bridge.spearActive && fm.bridge.lineA != null) {
          const spearA = fishingPolarToXY(fm.bridge.lineA, outerRadius);
          renderFishingSpearSprite(spearA, { x: fm.bridge.tipX, y: fm.bridge.tipY });
        } else {
          fishingEls.spearRope.setAttribute('opacity', '0');
          fishingEls.spearSpriteWrap.setAttribute('opacity', '0');
        }

        renderFishingImageFish(fm);

        fishingEls.status.textContent = fm.message;
        fishingEls.status.className = 'fish-status' + (fm.messageType ? ' ' + fm.messageType : '');
        fishingEls.panicFill.style.width = fm.panic + '%';
      }

      function describeFishingArc(radius, startDeg, endDeg) {
        const start = fishingPolarToXY(startDeg, radius);
        const end = fishingPolarToXY(endDeg, radius);
        const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
        return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
      }

      const PERP_DEAD_DEG = window.SCRATCHBONES_CONFIG?.game?.movement?.perpRotDeadzoneDeg ?? 40;
      const PERP_DEAD_RAD = PERP_DEAD_DEG * Math.PI / 180;
      // Creatures get a narrower dead zone than player/NPC (see cameraRelativeCreaturePerps).
      const CREATURE_PERP_DEAD_DEG = window.SCRATCHBONES_CONFIG?.game?.movement?.creaturePerpRotDeadzoneDeg ?? 30;
      const CREATURE_PERP_DEAD_RAD = CREATURE_PERP_DEAD_DEG * Math.PI / 180;
      // Extra margin required to *exit* a dead zone once locked into it, on top of
      // the radius required to *enter* it. Without this, a rawTarget hovering right
      // at the dead zone's edge (e.g. from per-frame tracking noise while chasing a
      // moving target) flips in and out every frame — visible as rotation flicker.
      const PERP_DEAD_HYSTERESIS_RAD = THREE.MathUtils.degToRad(6);

      // Keeps model rotation outside dead zones around each perp angle (radius given
      // by deadRad, defaulting to PERP_DEAD_RAD).
      // state: persistent object per entity (must survive across frames).
      // Returns { effectiveTarget, snapTo } where snapTo is non-null when the model
      // should teleport (raw target crossed through a perp to the far side).
      //
      // Only the perp nearest rawTarget is ever evaluated. angleDiff wraps at
      // ±π, so a *far* perp's side classification flips discontinuously right
      // at that far perp's antipodal point — which is exactly where the
      // *near* perp sits. Evaluating every perp every frame let that far-side
      // flip fire a spurious snapTo while the model was stably locked near
      // the near perp, producing rapid alternation between two rotations.
      function perpClamp(state, rawTarget, perps, deadRad = PERP_DEAD_RAD) {
        if (!state.perpSides) state.perpSides = perps.map(() => null);
        if (!state.locked) state.locked = perps.map(() => false);
        let nearestI = 0, nearestAbs = Infinity, nearestDT = 0;
        for (let i = 0; i < perps.length; i++) {
          const dT = angleDiff(rawTarget, perps[i]);
          const a = Math.abs(dT);
          if (a < nearestAbs) { nearestAbs = a; nearestI = i; nearestDT = dT; }
        }
        const P = perps[nearestI];
        // Hysteresis: once locked, require crossing the wider exit radius before
        // unlocking; once free, require crossing the (narrower) entry radius before
        // locking. Prevents boundary chatter when rawTarget hovers near the edge.
        const wasLocked = state.locked[nearestI];
        const isLocked = wasLocked ? nearestAbs < deadRad + PERP_DEAD_HYSTERESIS_RAD : nearestAbs < deadRad;
        let effectiveTarget = rawTarget;
        let snapTo = null;
        if (!isLocked) {
          const newSide = nearestDT > 0 ? 1 : -1;
          if (state.perpSides[nearestI] !== null && state.perpSides[nearestI] !== newSide) {
            snapTo = P + newSide * deadRad;
          }
          state.perpSides[nearestI] = newSide;
        } else {
          if (state.perpSides[nearestI] === null) state.perpSides[nearestI] = nearestDT >= 0 ? 1 : -1;
          effectiveTarget = P + state.perpSides[nearestI] * deadRad;
        }
        state.locked[nearestI] = isLocked;
        return { effectiveTarget, snapTo };
      }

      // For creature PNG planes: like perpClamp but linearly maps through the
      // dead zone (entry-edge → exit-edge) so the sprite never freezes at the
      // perpendicular — it sweeps across the camera-perpendicular range instead.
      function pngDeadzoneTarget(state, rawTarget, perps, deadRad) {
        if (!state.perpSides) state.perpSides = perps.map(() => null);
        if (!state.locked)    state.locked    = perps.map(() => false);
        let nearestI = 0, nearestAbs = Infinity, nearestDT = 0;
        for (let i = 0; i < perps.length; i++) {
          const dT = angleDiff(rawTarget, perps[i]);
          const a = Math.abs(dT);
          if (a < nearestAbs) { nearestAbs = a; nearestI = i; nearestDT = dT; }
        }
        const P = perps[nearestI];
        const wasLocked = state.locked[nearestI];
        const isLocked = wasLocked ? nearestAbs < deadRad + PERP_DEAD_HYSTERESIS_RAD : nearestAbs < deadRad;
        state.locked[nearestI] = isLocked;
        if (!isLocked) {
          state.perpSides[nearestI] = nearestDT > 0 ? 1 : -1;
          return rawTarget;
        }
        if (state.perpSides[nearestI] === null) state.perpSides[nearestI] = nearestDT >= 0 ? 1 : -1;
        const entrySign = state.perpSides[nearestI];
        // Target the EXIT edge so pngRot lerps across the deadzone rather
        // than stalling at the entry edge. The lerp in updateCreatureMesh
        // drives the smooth sweep over time.
        // (Note: returning a linear rawTarget mapping is a mathematical
        // identity that produces no visible effect — must target exit edge.)
        return P - entrySign * deadRad;
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

      // ── Lantern light masks ────────────────────────────────────────────
      // Carried by the player and any NPC tagged "watch" (the Watch). Punches
      // a soft hole through the day/night darkness tint: a short inner ring
      // where the tint is almost fully cleared (actual clarity), surrounded
      // by a much larger, dim halo (the lantern "shines" further than it
      // actually reveals detail).
      const LANTERN_CLARITY_TILES = 1.3; // fully-cleared radius, in tiles
      const LANTERN_SHINE_TILES   = 5.0; // total falloff radius, in tiles

      function _lanternScreenRadius(tx, tz, tiles) {
        const c = worldToOverlay(tx, 0.5, tz);
        const e = worldToOverlay(tx + tiles, 0.5, tz);
        return Math.hypot(e.x - c.x, e.y - c.y);
      }

      function drawLanternMasks() {
        const carriers = [{ x: player.x / TILE, z: player.y / TILE }];
        for (const w of npcWalkers) {
          if (w.area === currentArea && w.rec?.tags?.includes('watch')) {
            carriers.push({ x: w.root.position.x, z: w.root.position.z });
          }
        }
        lctx.globalCompositeOperation = 'destination-out';
        for (const c of carriers) {
          const center = worldToOverlay(c.x, 0.5, c.z);
          if (!center.visible) continue;
          const shineR = _lanternScreenRadius(c.x, c.z, LANTERN_SHINE_TILES);
          if (!(shineR > 0)) continue;
          const clarityFrac = Math.min(0.9, LANTERN_CLARITY_TILES / LANTERN_SHINE_TILES);
          const grad = lctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, shineR);
          grad.addColorStop(0,                              'rgba(0,0,0,0.92)');
          grad.addColorStop(clarityFrac,                     'rgba(0,0,0,0.80)');
          grad.addColorStop(Math.min(1, clarityFrac + 0.18), 'rgba(0,0,0,0.28)');
          grad.addColorStop(1,                               'rgba(0,0,0,0)');
          lctx.fillStyle = grad;
          lctx.beginPath();
          lctx.arc(center.x, center.y, shineR, 0, Math.PI * 2);
          lctx.fill();
        }
        lctx.globalCompositeOperation = 'source-over';
      }

      let _lastLightingOverlayTime = 0;
      function drawLightingOverlay() {
        const now = performance.now();
        if (now - _lastLightingOverlayTime < 100 && lightningAlpha <= 0 && sceneTransAlpha <= 0) return;
        _lastLightingOverlayTime = now;
        const rect = _threeRect;
        lctx.clearRect(0, 0, rect.width, rect.height);

        if (currentArea === 'interior' || _isBuildingArea(currentArea)) {
          // Interior/building: no outdoor day/night overlay — just warm interior ambience
          lctx.fillStyle = 'rgba(80,40,10,0.08)';
          lctx.fillRect(0, 0, rect.width, rect.height);
          if (sceneTransAlpha > 0) {
            lctx.fillStyle = `rgba(0,0,0,${sceneTransAlpha})`;
            lctx.fillRect(0, 0, rect.width, rect.height);
          }
          return;
        }

        const { r, g, b, a } = getLightingState();
        const W = rect.width;
        const H = rect.height;

        // Flat sky tint (ported from ScratchbonesGame's outdoor lighting):
        // screen-blend at low opacity adds warmth/brightness on clear days,
        // multiply-blend once opacity climbs darkens normally toward dusk/night.
        // The opacity transitions through near-zero at phase boundaries,
        // hiding the blend-mode switch.
        lctx.globalCompositeOperation = a < 0.09 ? 'screen' : 'multiply';
        lctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
        lctx.fillRect(0, 0, W, H);
        lctx.globalCompositeOperation = 'source-over';

        drawLanternMasks();

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

      function _computeRawLightingState() {
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

        return { r, g, b, a };
      }

      // Smoothed lighting state — eases toward the raw target each frame so
      // the lantern's punched-through clarity (and the sky/ambient tint) fade
      // gradually instead of snapping, most noticeably at the day-rollover
      // instant when getHour() jumps straight from ~22 back to 6.
      let _lightR = 10, _lightG = 10, _lightB = 40, _lightA = 0.72;
      let _lightingInitialized = false;
      function _advanceSmoothedLighting(dt) {
        const raw = _computeRawLightingState();
        if (!_lightingInitialized) {
          _lightR = raw.r; _lightG = raw.g; _lightB = raw.b; _lightA = raw.a;
          _lightingInitialized = true;
          return;
        }
        const tc = 1.5; // seconds — gentle fade, imperceptible as a "step"
        const k = 1 - Math.exp(-dt / tc);
        _lightR += (raw.r - _lightR) * k;
        _lightG += (raw.g - _lightG) * k;
        _lightB += (raw.b - _lightB) * k;
        _lightA += (raw.a - _lightA) * k;
      }

      function getLightingState() {
        return { r: Math.round(_lightR), g: Math.round(_lightG), b: Math.round(_lightB), a: _lightA };
      }

      function updateWaterParticles(dt) {
        // Spawn particles on flowing trench tiles.
        // _flowingTrenchTiles is rebuilt each sim tick so no full grid scan is needed.
        const flowingTiles = currentArea === 'town' ? _townFlowingTrenchTiles : _flowingTrenchTiles;
        for (const { col, row } of flowingTiles) {
          if (waterParticles.length < MAX_PARTICLES && Math.random() < 0.12) {
            const tx = col * TILE + 10 + Math.random() * (TILE - 20);
            const ty = row * TILE + 8 + Math.random() * (TILE - 16);
            waterParticles.push({
              wx: tx, wy: ty,
              vx: (Math.random() - 0.5) * 4,
              vy: 4 + Math.random() * 12,
              alpha: 0.7 + Math.random() * 0.3,
              radius: 1 + Math.random() * 2.5,
              life: 0,
              maxLife: 0.4 + Math.random() * 0.6,
              type: Math.random() < 0.6 ? 'bubble' : 'foam'
            });
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
          const aGrid = getActiveGrid(), aC = getActiveCols(), aR = getActiveRows();
          const onFlow = pc >= 0 && pc < aC && pr >= 0 && pr < aR
            && aGrid[pr][pc].type === TileType.TRENCH && aGrid[pr][pc].flow;
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
        const aGrid = getActiveGrid(), aC = getActiveCols(), aR = getActiveRows();
        for (let row = 0; row < aR; row++) {
          for (let col = 0; col < aC; col++) {
            const tile = aGrid[row][col];
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

      // Ported from ScratchbonesGame's outdoor lightning: a strike sequence is
      // 1 flash (520ms fade) or, 30% of the time, 2 flashes — a bright lead
      // strike that cuts to a brief dark gap, then a dimmer second flash.
      const LIGHTNING_AVG_INTERVAL_S = 28; // average seconds between strike sequences during a storm
      function updateLightningFlash(dt) {
        const stormActive = calendar.isRaining && calendar.rainStrength >= 3;
        if (stormActive && lightningStrikesRemaining <= 0) {
          lightningTimer -= dt;
          if (lightningTimer <= 0) {
            lightningStrikesRemaining = Math.random() < 0.30 ? 2 : 1;
            lightningAlpha = 0.72;
            lightningDecayRate = 0.72 / (lightningStrikesRemaining > 1 ? 0.09 : 0.52);
            lightningTimer = LIGHTNING_AVG_INTERVAL_S * (0.4 + Math.random() * 1.2);
          }
        }
        if (lightningStrikesRemaining > 0) {
          if (lightningAlpha > 0) {
            lightningAlpha = Math.max(0, lightningAlpha - lightningDecayRate * dt);
            if (lightningAlpha <= 0 && lightningStrikesRemaining > 1) lightningGapTimer = 0.055;
          } else if (lightningGapTimer > 0) {
            lightningGapTimer -= dt;
            if (lightningGapTimer <= 0) {
              lightningStrikesRemaining -= 1;
              if (lightningStrikesRemaining > 0) {
                lightningAlpha = 0.52;
                lightningDecayRate = 0.52 / (lightningStrikesRemaining > 1 ? 0.09 : 0.52);
              }
            }
          } else {
            lightningStrikesRemaining = 0;
          }
        }
      }

      // ── Layered rain audio (ported from ScratchbonesGame's outdoor weather) ──
      // Three pink-noise sources at different playback rates, each narrowed by
      // its own filter band (bright/mid/rumble), cross-faded by rain intensity.
      function _buildRainPinkNoise(audioCtx) {
        const len = audioCtx.sampleRate * 2;
        const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
        const d = buf.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0;
        for (let i = 0; i < len; i++) {
          const w = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + w * 0.0555179;
          b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.96900 * b2 + w * 0.1538520;
          b3 = 0.86650 * b3 + w * 0.3104856;
          b4 = 0.55000 * b4 + w * 0.5329522;
          b5 = -0.7616 * b5 - w * 0.0168980;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + w * 0.5362) * 0.10;
        }
        return buf;
      }

      function _createRainAudio() {
        let ctx = null, gainH = null, gainM = null, gainL = null, lpf = null, started = false;

        function start() {
          if (started) return;
          started = true;
          try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            ctx = window._rainAudioCtx || (window._rainAudioCtx = new AudioCtx());
            const buf = _buildRainPinkNoise(ctx);

            function makeSource(rate) {
              const s = ctx.createBufferSource();
              s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start();
              return s;
            }
            const srcH = makeSource(1.00);
            const srcM = makeSource(0.95);
            const srcL = makeSource(0.81);

            // Tighter Q than the original port (and quieter master gain below) —
            // same scuffy/noise-heavy, narrow-band treatment given to footsteps
            // (FOOTSTEP_POST_FX bandpass Q ~0.9-2.8) instead of smooth broadband hiss.
            const hpf = ctx.createBiquadFilter();
            hpf.type = 'highpass'; hpf.frequency.value = 950; hpf.Q.value = 1.6;
            const bpf = ctx.createBiquadFilter();
            bpf.type = 'bandpass'; bpf.frequency.value = 330; bpf.Q.value = 1.8;
            lpf = ctx.createBiquadFilter();
            lpf.type = 'lowpass'; lpf.frequency.value = 115; lpf.Q.value = 1.4;

            gainH = ctx.createGain(); gainH.gain.value = 0;
            gainM = ctx.createGain(); gainM.gain.value = 0;
            gainL = ctx.createGain(); gainL.gain.value = 0;

            const master = ctx.createGain();
            master.gain.value = Math.max(0, Number(gameAudioConfig().rainVolume) || 0.20);

            srcH.connect(hpf); hpf.connect(gainH); gainH.connect(master);
            srcM.connect(bpf); bpf.connect(gainM); gainM.connect(master);
            srcL.connect(lpf); lpf.connect(gainL); gainL.connect(master);
            master.connect(ctx.destination);
          } catch (e) {
            console.warn('[rainAudio] Web Audio unavailable:', e);
          }
        }

        function setIntensity(v) {
          if (!ctx || !gainH) return;
          if (ctx.state === 'suspended') ctx.resume().catch(() => {});
          const now = ctx.currentTime, tc = 1.2;
          gainH.gain.setTargetAtTime(v * 1.0, now, tc);
          gainM.gain.setTargetAtTime(v * 0.72, now, tc);
          const lv = v > 0.5 ? Math.pow((v - 0.5) * 2, 1.6) : 0;
          gainL.gain.setTargetAtTime(lv * 0.68, now, tc);
          if (lpf) lpf.frequency.setTargetAtTime(145 - v * 73, now, tc);
        }

        return { start, setIntensity };
      }

      let _rainAudio = null;
      function updateRainAudio() {
        const audioCfg = gameAudioConfig();
        if (audioCfg.enabled === false) return;
        const outdoors = currentArea === 'farm' || currentArea === 'town';
        const indoors = currentArea === 'interior' || _isBuildingArea(currentArea);
        const intensity = (outdoors && !indoors && calendar.isRaining)
          ? Math.min(1, (calendar.rainStrength || 0) / 3)
          : 0;
        if (!_rainAudio) _rainAudio = _createRainAudio();
        if (intensity > 0) _rainAudio.start();
        _rainAudio.setIntensity(intensity);
      }

      function tileSpeedAt(wx, wy) {
        const aC = getActiveCols(), aR = getActiveRows();
        if (wx < 0 || wy < 0 || wx >= aC * TILE || wy >= aR * TILE) return null;
        const col  = Math.floor(wx / TILE);
        const row  = Math.floor(wy / TILE);
        const tile = getActiveGrid()[row][col];
        const type = tile.type;
        if (isSolid(type)) return null;
        // Auto-reserved plateau cliff-face ring — impassable except where a
        // ramp tile explicitly cuts through it (which never sets `incline`).
        if (tile.incline) return null;
        // Rivers/streams are a real crossing obstacle — block like a solid tile.
        if (type === TileType.RIVER || type === TileType.STREAM) return null;
        // Block structural building tiles on exterior maps (player must use doors/transitions).
        if (currentArea === 'farm' && isHouseFootprint(col, row)) return null;
        if (currentArea === 'town' && isTownBuildingCollisionTile(col, row)) return null;
        if (_isZoneArea(currentArea) && isTownBuildingCollisionTile(col, row, currentArea)) return null;
        // Farm terrain no longer slows movement — keeps farm traversal feeling
        // as snappy as town, matching the player's uniform GRASS speed there.
        if (currentArea === 'farm') return 1.00;
        return {
          [TileType.GRASS]:   1.00,
          [TileType.TILLED]:  0.85,
          [TileType.WEEDS]:   1.00,
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

      // Interior lighting — dark room, single warm lantern
      const _intAmbient = new THREE.AmbientLight(0xffd090, 0.15);
      interiorScene.add(_intAmbient);
      const _intKey = new THREE.DirectionalLight(0xfff0cc, 0.08);
      _intKey.position.set(2, 6, 3);
      interiorScene.add(_intKey);
      const _intFill = new THREE.PointLight(0xff8833, 0.35, 6);
      _intFill.position.set(3, 1.8, 2.5);  // centre of 6×5 main room, dim fallback so placed lamps/candles/hearths stand out
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
        { id: 'n_wall',  width: 12, height: INTERIOR_WALL_HEIGHT, position: [6,  0, 0],    rotationDeg: [0,   0, 0] },
        { id: 'w_wall',  width: 10, height: INTERIOR_WALL_HEIGHT, position: [0,  0, 5],    rotationDeg: [0,  90, 0] },
        { id: 'e_wall',  width: 10, height: INTERIOR_WALL_HEIGHT, position: [12, 0, 5],    rotationDeg: [0, -90, 0] },
        { id: 's_left',  width: 4,  height: INTERIOR_WALL_HEIGHT, position: [2,  0, 10],   rotationDeg: [0, 180, 0] },
        { id: 's_right', width: 4,  height: INTERIOR_WALL_HEIGHT, position: [10, 0, 10],   rotationDeg: [0, 180, 0] },
        // Corridor side walls — south end kept open (no exit_s)
        { id: 'exit_w',  width: 2,  height: INTERIOR_WALL_HEIGHT, position: [4,  0, 11],   rotationDeg: [0,  90, 0] },
        { id: 'exit_e',  width: 2,  height: INTERIOR_WALL_HEIGHT, position: [8,  0, 11],   rotationDeg: [0, -90, 0] },
      ];

      // Built lazily on first entry to avoid blocking startup; called by enterInterior().
      function buildInteriorScene() {
        if (interiorSceneBuilt) return;
        interiorSceneBuilt = true;

        // Floor — boards.png if present, warm brown placeholder otherwise
        const floorMat = new THREE.MeshLambertMaterial({ color: 0x8b6914 });
        new THREE.TextureLoader().load(
          'assets/textures/boards.png',
          (tex) => {
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            floorMat.map = tex;
            floorMat.color.set(0xffffff);
            floorMat.needsUpdate = true;
          },
          undefined,
          () => {}
        );

        // Floor tiles: main room 12×10 + corridor 4×2; exit tiles use same material
        const floorCells = [];
        for (let r = 0; r < 10; r++) for (let c = 0; c < 12; c++) floorCells.push([c, r]);
        for (let r = 10; r <= 11; r++) for (let c = 4; c <= 7; c++) floorCells.push([c, r]);
        for (const [c, r] of floorCells) {
          const fl = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 1), floorMat);
          fl.position.set(c + 0.5, -0.05, r + 0.5);
          fl.receiveShadow = true;
          interiorScene.add(fl);
        }

        // Black backing planes — render first (renderOrder=-1), no depth write.
        // Bricks overwrite them; pure black shows only through gaps between bricks.
        // Each plane is slightly smaller than its panel to stay inside the brick boundary.
        const _backingMat = new THREE.MeshBasicMaterial({
          color: 0x000000, side: THREE.DoubleSide,
          depthWrite: false, depthTest: false
        });
        for (const p of INTERIOR_WALL_PANELS) {
          const bw = Math.max(0.2, p.width  - (p.width <= 1.5 ? 0.08 : 0.3));
          const bh = Math.max(0.2, p.height - 0.2);
          const _bg = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), _backingMat);
          _bg.renderOrder = -1;
          _bg.position.set(0, p.height / 2, 0);
          const _pg = new THREE.Group();
          _pg.position.set(p.position[0], p.position[1], p.position[2]);
          _pg.rotation.set(
            THREE.MathUtils.degToRad(p.rotationDeg[0] || 0),
            THREE.MathUtils.degToRad(p.rotationDeg[1] || 0),
            THREE.MathUtils.degToRad(p.rotationDeg[2] || 0)
          );
          _pg.add(_bg);
          interiorScene.add(_pg);
        }

        // Outside ambient light seeping in through the corridor exit — cool daylight cone
        const _exitSpot = new THREE.SpotLight(0xb4d8ff, 2.5, 12, 0.5, 0.7, 1.5);
        _exitSpot.position.set(6, 3, 14);
        _exitSpot.target.position.set(6, 0, 11);
        interiorScene.add(_exitSpot);
        interiorScene.add(_exitSpot.target);

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
          // NOTE: do not redeclare "attribute mat4 instanceMatrix" here — for a
          // regular (non-Raw) ShaderMaterial, three.js's WebGLProgram already
          // injects that exact declaration into the vertex shader prefix
          // whenever USE_INSTANCING is defined. Redeclaring it is a duplicate
          // attribute and fails to compile/link, which silently dropped the
          // outline for every InstancedMesh (wall bricks) using this material.
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

      // Shared vertex shader used for coloured target outlines (supports instancing)
      const _targetOutlineVert = `
        // See shellOutlineMat above — three.js's own vertex-shader prefix
        // already declares "attribute mat4 instanceMatrix" under
        // USE_INSTANCING for ShaderMaterial, so it must not be redeclared here.
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
          clip.xy += dir * uThickness * clip.w;
          gl_Position = clip;
        }
      `;
      const targetOutlineGreenMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: { uThickness: { value: 0.009 } },
        vertexShader: _targetOutlineVert,
        fragmentShader: `void main() { gl_FragColor = vec4(0.08, 0.95, 0.18, 1.0); }`,
        depthWrite: false, depthFunc: THREE.LessDepth,
      });
      const targetOutlineRedMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: { uThickness: { value: 0.009 } },
        vertexShader: _targetOutlineVert,
        fragmentShader: `void main() { gl_FragColor = vec4(0.95, 0.12, 0.08, 1.0); }`,
        depthWrite: false, depthFunc: THREE.LessDepth,
      });
      let _targetOutlineMeshes = [];
      let _targetOutlineAllowed = true;
      function clearTargetHighlights() {
        for (const m of _targetOutlineMeshes) m.layers.disable(2);
        _targetOutlineMeshes = [];
        updateCuttableBillboardGlow(0, 0, false);
      }
      function findTargetMeshes(col, row) {
        const i = row * COLS + col;
        const out = [];
        const obj = getWorldObjectAt(col, row);
        if (obj && obj.mesh) {
          out.push(obj.mesh);
          if (obj.lid) out.push(obj.lid);
          return out;
        }
        if (cropMeshes[i]) {
          cropMeshes[i].traverse(m => { if (m.isMesh) out.push(m); });
          if (out.length) return out;
        }
        if (vegFoliageMeshes[i]) {
          vegFoliageMeshes[i].traverse(m => { if (m.isMesh) out.push(m); });
        }
        return out;
      }

      // ── Screen-space outline pass (depth edges + furniture material seams) ──
      // Two extra outline sources layered on top of the per-mesh shell outline
      // above, both detected as a post-process over the rendered frame:
      //   1. Depth discontinuities — catches silhouettes the shell pass misses,
      //      e.g. one object's edge against another object/the floor behind it.
      //   2. Furniture "material ID" seams — catches boundaries between two
      //      touching parts of the same furniture group (e.g. a chair leg
      //      against the seat) where depth is continuous but the part changes,
      //      so neither the shell pass nor depth edges would draw a line.
      // Layer 3 is reserved for furniture parts feeding the material-ID buffer.

      // PNG-plane avatars (player/NPCs/animals/creatures) are flat cutout
      // sprites — running depth-edge detection against them would outline
      // every alpha-cutout silhouette edge of the sprite art itself, which
      // reads as noise rather than a deliberate outline. Tagging their root
      // group lets the depth-only source pass below hide them temporarily
      // without touching the main colour pass that actually shows them.
      function _markPngPlane(obj) {
        if (obj) obj.userData.isPngPlane = true;
      }

      let _furnitureEdgeIdSeq = 0;
      function _markFurnitureEdgeId(obj) {
        if (!obj) return;
        const apply = (m) => {
          m.layers.enable(3);
          const hue = (_furnitureEdgeIdSeq++ * 0.6180339887) % 1;
          const idColor = new THREE.Color().setHSL(hue, 0.85, 0.55);
          m.onBeforeRender = function (renderer, scene, camera, geometry, material) {
            if (material !== _furnitureIdMat) return;
            _furnitureIdMat.uniforms.uIdColor.value.copy(idColor);
            // Every tagged part shares this one material instance, so the
            // renderer's "material/program unchanged since last draw" cache
            // would otherwise skip re-uploading the uniform we just mutated —
            // only the first part drawn each frame would ever reach the GPU.
            _furnitureIdMat.uniformsNeedUpdate = true;
          };
        };
        if (obj.isMesh) { apply(obj); return; }
        obj.traverse(child => { if (child.isMesh) apply(child); });
      }

      // Flat-unlit material shared by every furniture part during the ID-buffer
      // pass; each part's onBeforeRender (above) stamps its own colour into the
      // shared uniform right before its draw call.
      const _furnitureIdMat = new THREE.ShaderMaterial({
        uniforms: { uIdColor: { value: new THREE.Color(0, 0, 0) } },
        vertexShader: `
          void main() {
            #ifdef USE_INSTANCING
              gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
            #else
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            #endif
          }
        `,
        fragmentShader: `
          uniform vec3 uIdColor;
          void main() { gl_FragColor = vec4(uIdColor, 1.0); }
        `,
      });

      // Main colour pass render target — keeps a depth texture around so the
      // composite shader below can read real per-pixel scene depth.
      function _makeSceneRT(w, h) {
        const rt = new THREE.WebGLRenderTarget(w, h, {
          minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat,
        });
        rt.depthTexture = new THREE.DepthTexture(w, h);
        return rt;
      }
      const _mainRT   = _makeSceneRT(1, 1);
      // Furniture/terrain material-ID buffer — alpha 0 means "nothing tagged
      // here". Carries its own depth texture (depth of the tagged objects
      // only, since the pass that fills this target restricts the camera to
      // layer 3) so the composite shader can tell whether a tagged surface is
      // actually the frontmost thing at that pixel before drawing its seam —
      // without that check, a tagged object hidden behind a wall would still
      // contribute an edge, since nothing else was rendered into this target
      // to occlude it.
      const _edgeIdRT = _makeSceneRT(1, 1);
      // Depth-only source for depth-edge detection — rendered with PNG-plane
      // avatars hidden (see _markPngPlane above) so the detector only sees
      // solid-geometry depth, never sprite-cutout silhouettes. colorWrite is
      // off since only the attached depth texture is read back.
      const _depthOnlyRT = _makeSceneRT(1, 1);
      const _depthOnlyMat = new THREE.MeshBasicMaterial({ colorWrite: false });
      function _resizeOutlineTargets(pixelW, pixelH) {
        _mainRT.setSize(pixelW, pixelH);
        _edgeIdRT.setSize(pixelW, pixelH);
        _depthOnlyRT.setSize(pixelW, pixelH);
        _postMat.uniforms.uTexel.value.set(1 / pixelW, 1 / pixelH);
      }

      // Fullscreen composite — blends depth-edge and furniture-seam outlines
      // over the rendered colour buffer.
      const _postScene  = new THREE.Scene();
      const _postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const _postMat = new THREE.ShaderMaterial({
        uniforms: {
          tColor: { value: null }, tDepth: { value: null }, tEdgeId: { value: null },
          tEdgeIdDepth: { value: null }, tSceneDepth: { value: null },
          uTexel: { value: new THREE.Vector2(1, 1) },
          uCameraNear: { value: 0.1 }, uCameraFar: { value: 200 },
          uDepthOutlinesOn: { value: 0 }, uDepthThreshScale: { value: 1 },
        },
        depthTest: false, depthWrite: false,
        vertexShader: `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
        `,
        fragmentShader: `
          uniform sampler2D tColor, tDepth, tEdgeId, tEdgeIdDepth, tSceneDepth;
          uniform vec2 uTexel;
          uniform float uCameraNear, uCameraFar;
          uniform float uDepthOutlinesOn, uDepthThreshScale;
          varying vec2 vUv;
          float linearDepth(float z) {
            float zNdc = z * 2.0 - 1.0;
            return (2.0 * uCameraNear * uCameraFar) / (uCameraFar + uCameraNear - zNdc * (uCameraFar - uCameraNear));
          }
          void main() {
            vec3 color = texture2D(tColor, vUv).rgb;

            float d0 = linearDepth(texture2D(tDepth, vUv).r);
            float dL = linearDepth(texture2D(tDepth, vUv - vec2(uTexel.x, 0.0)).r);
            float dR = linearDepth(texture2D(tDepth, vUv + vec2(uTexel.x, 0.0)).r);
            float dU = linearDepth(texture2D(tDepth, vUv + vec2(0.0, uTexel.y)).r);
            float dD = linearDepth(texture2D(tDepth, vUv - vec2(0.0, uTexel.y)).r);
            float depthDelta  = max(max(abs(d0 - dL), abs(d0 - dR)), max(abs(d0 - dU), abs(d0 - dD)));
            float depthThresh = mix(0.015, 0.6, clamp(d0 / uCameraFar, 0.0, 1.0)) * uDepthThreshScale;
            float depthEdge   = step(depthThresh, depthDelta) * uDepthOutlinesOn;

            vec4 id0 = texture2D(tEdgeId, vUv);
            vec4 idL = texture2D(tEdgeId, vUv - vec2(uTexel.x, 0.0));
            vec4 idR = texture2D(tEdgeId, vUv + vec2(uTexel.x, 0.0));
            vec4 idU = texture2D(tEdgeId, vUv + vec2(0.0, uTexel.y));
            vec4 idD = texture2D(tEdgeId, vUv - vec2(0.0, uTexel.y));
            float idEdge = 0.0;
            idEdge = max(idEdge, (id0.a > 0.5 && idL.a > 0.5 && distance(id0.rgb, idL.rgb) > 0.1) ? 1.0 : 0.0);
            idEdge = max(idEdge, (id0.a > 0.5 && idR.a > 0.5 && distance(id0.rgb, idR.rgb) > 0.1) ? 1.0 : 0.0);
            idEdge = max(idEdge, (id0.a > 0.5 && idU.a > 0.5 && distance(id0.rgb, idU.rgb) > 0.1) ? 1.0 : 0.0);
            idEdge = max(idEdge, (id0.a > 0.5 && idD.a > 0.5 && distance(id0.rgb, idD.rgb) > 0.1) ? 1.0 : 0.0);

            // Occlusion test — the ID buffer was rendered with only the
            // tagged objects in view, so it has no idea a wall or other
            // untagged object sits in front of them. Compare its own depth
            // against the real scene depth at this pixel and drop the seam
            // if something closer to the camera is actually there.
            float idDepth    = linearDepth(texture2D(tEdgeIdDepth, vUv).r);
            float sceneDepth = linearDepth(texture2D(tSceneDepth, vUv).r);
            idEdge *= step(idDepth, sceneDepth + 0.05);

            float edge = max(depthEdge, idEdge);
            gl_FragColor = vec4(mix(color, vec3(0.0), edge), 1.0);
          }
        `,
      });
      _postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), _postMat));

      let s_zoomScale = 1.5; // camera zoom level — higher = camera sits closer to the player (default 150%)

      // Camera — mode-driven, with the default preserving the original isometric follow.
      const camera = new THREE.PerspectiveCamera(cameraModeConfig('default').fovDeg ?? 42, 1, 0.1, 200);
      let camTargetX = COLS / 2, camTargetZ = ROWS * 0.72, camTargetY = 0;
      // Snaps the camera's follow target to the player's current position,
      // including ground height — exterior zones now carry real per-tile
      // elevTier (plateau tiers merged into one scene, ramps sloping between
      // them), so the camera must track actual terrain height instead of
      // assuming a flat Y=0 ground plane, or a player standing on an elevated
      // tier renders far below where the camera is looking.
      function _playerGroundY() {
        const col = Math.floor(player.x / TILE), row = Math.floor(player.y / TILE);
        const tile = getActiveGrid()?.[row]?.[col];
        return tile ? tileSurfaceYInArea(tile, currentArea) : 0;
      }
      function _snapCameraTarget() {
        camTargetX = player.x / TILE;
        camTargetZ = player.y / TILE;
        camTargetY = _playerGroundY();
      }

      function portraitAvatarCenterWorldPosition(root) {
        let avatarRoot = null;
        root?.traverse?.(child => {
          if (!avatarRoot && Number.isFinite(child.userData?.portraitModelHeight)) avatarRoot = child;
        });
        if (!avatarRoot) return null;
        const center = new THREE.Vector3();
        avatarRoot.updateWorldMatrix?.(true, false);
        avatarRoot.getWorldPosition(center);
        const height = avatarRoot.userData.portraitModelHeight;
        const placementRatio = avatarRoot.userData.portraitVerticalPlacementRatio ?? 0.5;
        center.y += (placementRatio - 0.5) * height;
        return center;
      }

      function dialoguePortraitCameraAim(modeCfg, tx, tz, distance, baseAngle) {
        if (!modeCfg.alignToDialoguePortraitCenters || !_dialogueWalker?.root) return null;
        const playerCenter = portraitAvatarCenterWorldPosition(playerMesh);
        const npcCenter = portraitAvatarCenterWorldPosition(_dialogueWalker.root);
        if (!playerCenter || !npcCenter) return null;
        const minDistance = modeCfg.portraitCenterMinDistanceTiles ?? 0.001;
        const portraitDistance = Math.max(
          minDistance,
          Math.hypot(npcCenter.x - playerCenter.x, npcCenter.z - playerCenter.z),
        );
        const rawPortraitPitch = Math.atan2(npcCenter.y - playerCenter.y, portraitDistance);
        const maxUpwardPitch = THREE.MathUtils.degToRad(modeCfg.maxUpwardPortraitPitchDeg ?? 0);
        const portraitPitch = Math.min(rawPortraitPitch, maxUpwardPitch);
        const cameraY = rawPortraitPitch > maxUpwardPitch
          ? (playerCenter.y + npcCenter.y) / 2
          : playerCenter.y;
        const cameraHorizontalDistance = Math.cos(baseAngle) * distance;
        return {
          cameraY,
          lookY: cameraY + Math.tan(portraitPitch) * cameraHorizontalDistance,
          targetX: tx,
          targetZ: tz,
        };
      }

      // Pulls the camera in along the target→camera line if a plateau mesa or
      // cliff-face rock skin (see their `.userData.cameraObstacle` tags,
      // collected once per zone as buildZoneScene's `occlusionMeshes`) sits
      // between them — the fixed south-of-player follow camera has no other
      // way to keep the player visible once something tall is in that gap,
      // since generation alone can bias terrain but can't guarantee a clear
      // line at this camera's shallow angle (see conversation history: even
      // a single-tier rise close to the player already eats most of the
      // vertical slack a ~14-tile, ~33°-elevation sightline allows). Scoped
      // to wilderness zones for now — town/farm have no elevation system to
      // occlude with.
      function occlusionSafeCameraPosition(lookAtX, lookAtY, lookAtZ, idealX, idealY, idealZ) {
        if (!_isZoneArea(currentArea)) return { x: idealX, y: idealY, z: idealZ };
        const obstacles = _zoneScenes.get(currentArea)?.occlusionMeshes;
        if (!obstacles || !obstacles.length) return { x: idealX, y: idealY, z: idealZ };
        const dx = idealX - lookAtX, dy = idealY - lookAtY, dz = idealZ - lookAtZ;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 0.5) return { x: idealX, y: idealY, z: idealZ };
        const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
        _cameraOcclusionRaycaster.set(new THREE.Vector3(lookAtX, lookAtY, lookAtZ), new THREE.Vector3(dir.x, dir.y, dir.z));
        _cameraOcclusionRaycaster.near = 0.3; // skip the player's own standing point
        _cameraOcclusionRaycaster.far = dist;
        const hits = _cameraOcclusionRaycaster.intersectObjects(obstacles, false);
        if (!hits.length) return { x: idealX, y: idealY, z: idealZ };
        // Stop a little short of the actual hit (not flush against it) so the
        // camera doesn't clip into the cliff face it just pulled in behind.
        const safeDist = Math.max(3, hits[0].distance - 0.6);
        // Wilderness plateaus can tower many tiers higher than anything an
        // authored map ever had, so a cliff can sit close enough to the
        // player that safeDist collapses near its floor — sliding straight
        // back along the same shallow ideal-camera ray then just jams the
        // camera face-first into that wall (a screen-filling close-up).
        // Lift the camera as it's pulled in, trading "close" for "more
        // overhead," so a tall nearby cliff still leaves the player and
        // their surroundings in view instead of one flat wall.
        const shrink = clamp(1 - safeDist / dist, 0, 1);
        const lift = shrink * dist * 0.5;
        return { x: lookAtX + dir.x * safeDist, y: lookAtY + dir.y * safeDist + lift, z: lookAtZ + dir.z * safeDist };
      }

      function updateCameraPosition() {
        const modeCfg = cameraModeConfig(activeCameraMode);
        const baseDistance = (modeCfg.distanceTiles ?? 14) / s_zoomScale;
        const distance = dialogueZoomActive() ? baseDistance / dialogueZoomFactor() : baseDistance;
        const angle = THREE.MathUtils.degToRad((modeCfg.angleFromGroundDeg ?? 32.73) + cameraAngleOffsetDeg);
        const azimuth = THREE.MathUtils.degToRad((modeCfg.azimuthDeg ?? 0) + cameraAzimuthOffsetDeg);
        const tx = camTargetX, tz = camTargetZ;
        const portraitAim = dialoguePortraitCameraAim(modeCfg, tx, tz, distance, angle);
        const lookY = portraitAim?.lookY ?? (camTargetY + (modeCfg.targetYOffsetTiles ?? 0));
        const cameraY = portraitAim?.cameraY ?? (lookY + Math.sin(angle) * distance);
        const groundDistance = Math.cos(angle) * distance;
        // Camera sits at `azimuth` east of due-south from the target, elevated,
        // looking back at it. azimuth=0 (every mode but "fishing") reduces to the
        // original due-south-looking-north framing.
        const lookAtX = portraitAim?.targetX ?? tx, lookAtZ = portraitAim?.targetZ ?? tz;
        const idealX = lookAtX + Math.sin(azimuth) * groundDistance;
        const idealZ = lookAtZ + Math.cos(azimuth) * groundDistance; // +Z = south
        const safe = occlusionSafeCameraPosition(lookAtX, lookY, lookAtZ, idealX, cameraY, idealZ);
        camera.position.set(safe.x, safe.y, safe.z);
        camera.lookAt(lookAtX, lookY, lookAtZ);
        camera.fov = modeCfg.fovDeg ?? 42;
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
      sunLight.shadow.mapSize.set(1024, 1024);
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
        path:   new THREE.MeshLambertMaterial({ color: 0xb8956a }),
        river:  new THREE.MeshLambertMaterial({ color: 0x3a4a3f }), // silty bed, seen through the water surface
        stream: new THREE.MeshLambertMaterial({ color: 0x6b5a3a }), // sandy streambed
        waterfall: new THREE.MeshLambertMaterial({ color: 0x3a4a3f }), // same bed as river — seen at the base of the curtain
      };
      // Floor material for vegetation tiles — matches weed foliage HSL color
      const vegFloorMat = new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(108 / 360, 0.58, 0.28) });

      // Fixed per-terrain-type ID colours feeding the same material-ID-seam
      // outline used for furniture (see _markFurnitureEdgeId), generalized to
      // ground tiles: unlike furniture (every part gets its own unique
      // colour, since any two touching parts should show a seam), terrain
      // tiles of the same type must share one colour so the seam only shows
      // up at real material boundaries — path/grass, stone/grass, water's
      // edge, etc. — not at every tile-to-tile grid line.
      const _terrainIdColors = (() => {
        const colors = {};
        let i = 0;
        for (const key of Object.keys(tileMats)) colors[key] = new THREE.Color().setHSL((i++ * 0.6180339887) % 1, 0.85, 0.55);
        colors.water = new THREE.Color().setHSL((i++ * 0.6180339887) % 1, 0.85, 0.55);
        return colors;
      })();
      function _terrainCategoryFor(type) {
        return tileMats[type] ? type : TileType.GRASS;
      }
      function _markTerrainEdgeId(mesh, category) {
        if (!mesh) return;
        const idColor = _terrainIdColors[category] || _terrainIdColors[TileType.GRASS];
        mesh.layers.enable(3);
        mesh.onBeforeRender = function (renderer, scene, camera, geometry, material) {
          if (material !== _furnitureIdMat) return;
          _furnitureIdMat.uniforms.uIdColor.value.copy(idColor);
          // See _markFurnitureEdgeId above — required so each tile's colour
          // actually reaches the GPU instead of reusing whatever the
          // previous tile sharing this material last uploaded.
          _furnitureIdMat.uniformsNeedUpdate = true;
        };
      }
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
      const reticleIntenseMat = new THREE.MeshBasicMaterial({
        color: 0xffffc8, wireframe: true, transparent: true, opacity: 1.0,
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
      // World-Y rise per plateau elevation tier (absolute units shared by each
      // merged tile's elevTier and authored ramp.rampElevation values — see
      // tileSurfaceYInArea / _loadTownFromWorkspace's mergeZoneTiles).
      const PLATEAU_UNIT = 2.5;
      const RIVER_TOP  = -0.55; // river bed — a wide channel, at least trench-deep
      const STREAM_TOP = -0.55; // stream bed — the actual painted waterway in current maps; same depth as the river
      const ROCK_H     =  0.75; // rock block height
      const ROCK_TOP   = NORMAL_TOP + ROCK_H;
      // Tile types whose ground geometry sinks below NORMAL_TOP (vs. RAISED, which rises).
      const DEPRESSION_TOP = {
        [TileType.TRENCH]:    TRENCH_TOP,
        [TileType.RIVER]:     RIVER_TOP,
        [TileType.STREAM]:    STREAM_TOP,
        [TileType.WATERFALL]: RIVER_TOP,
      };

      const WATER_UNIT = SLAB_H / MAX_WATER; // world-Y per water depth unit

      // Y center of each tile's primary mesh
      function tileYCenter(type) {
        switch (type) {
          case TileType.TRENCH:    return TRENCH_TOP - SLAB_H / 2;   // -0.75
          case TileType.RIVER:     return RIVER_TOP  - SLAB_H / 2;
          case TileType.STREAM:    return STREAM_TOP - SLAB_H / 2;
          case TileType.WATERFALL: return RIVER_TOP  - SLAB_H / 2;
          case TileType.RAISED:    return RAISED_TOP - SLAB_H / 2;   // +0.25
          case TileType.ROCK:   return NORMAL_TOP + ROCK_H / 2;   // +0.375
          case TileType.SHRUB:  return NORMAL_TOP + VEG_H / 2;    // slab on surface
          case TileType.WEEDS:  return NORMAL_TOP + VEG_H / 2;
          default:              return NORMAL_TOP - SLAB_H / 2;   // -0.25 (grass/tilled/paddy)
        }
      }

      // Surface top Y for water placement and player standing
      function tileSurfaceY(type) {
        switch (type) {
          case TileType.TRENCH:    return TRENCH_TOP;
          case TileType.RIVER:     return RIVER_TOP;
          case TileType.STREAM:    return STREAM_TOP;
          case TileType.WATERFALL: return RIVER_TOP;
          case TileType.RAISED:    return RAISED_TOP;
          case TileType.ROCK:      return ROCK_TOP;
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

      // Merge many small per-tile geometries (each in local -0.5..0.5 tile space)
      // into a single BufferGeometry, baking in world-space (x,y,z) offsets per
      // entry. Lets hundreds/thousands of seam-safe per-tile heightfield tiles
      // collapse into one draw call per material instead of one mesh per tile.
      function _mergeTileGeos(entries) {
        // Recomputing normals on the merged buffer is mathematically the same
        // as computing them per-entry (entries never share vertex indices, so
        // there's no cross-entry averaging either way) — EXCEPT it silently
        // discards any normal attribute an entry already carries. Some entries
        // (e.g. the path network's pathGeo/grassGeo split) deliberately set a
        // normal computed jointly across a sibling geometry that lives in a
        // *different* bucket/material, to avoid a lighting seam where they
        // meet. Preserve those instead of overwriting them.
        for (const e of entries) {
          if (!e.geo.attributes.normal) e.geo.computeVertexNormals();
        }
        let vertCount = 0, idxCount = 0;
        for (const e of entries) {
          vertCount += e.geo.attributes.position.count;
          idxCount  += e.geo.index ? e.geo.index.count : e.geo.attributes.position.count;
        }
        const positions = new Float32Array(vertCount * 3);
        const normals = new Float32Array(vertCount * 3);
        const indices = vertCount > 65535 ? new Uint32Array(idxCount) : new Uint16Array(idxCount);
        let vOff = 0, iOff = 0, vBase = 0;
        for (const e of entries) {
          const pa = e.geo.attributes.position;
          const na = e.geo.attributes.normal;
          for (let i = 0; i < pa.count; i++) {
            positions[vOff]   = pa.getX(i) + e.x;
            positions[vOff+1] = pa.getY(i) + e.y;
            positions[vOff+2] = pa.getZ(i) + e.z;
            normals[vOff]   = na.getX(i);
            normals[vOff+1] = na.getY(i);
            normals[vOff+2] = na.getZ(i);
            vOff += 3;
          }
          const idx = e.geo.index;
          if (idx) {
            for (let i = 0; i < idx.count; i++) indices[iOff++] = idx.getX(i) + vBase;
          } else {
            for (let i = 0; i < pa.count; i++) indices[iOff++] = i + vBase;
          }
          vBase += pa.count;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        g.setIndex(new THREE.BufferAttribute(indices, 1));
        return g;
      }

      // ── Path tile: worn depression with adjacency-aware torn edges ───────────
      // Same heightfield pipeline as buildTerrainTileGeo (TRENCH/RAISED) but with
      // a shallow depth (-0.09) so it reads as a foot-worn groove in the earth.
      // Adjacent PATH tiles open the blend so connected tiles flow into each other.
      // Geometry is split into pathGeo (depressed cells, path material) and
      // grassGeo (edge cells blending back to NORMAL_TOP, grass material) — the
      // same dual-mesh pattern used by rock and trench tiles.
      function buildPathTileGeo(col, row, srcGrid = grid) {
        const VERTS = 7, CELLS = 6, STEP = 1.0 / CELLS;
        const BLEND_V  = 2;
        const PATH_DY  = -0.045;  // depression depth — shallow, rock-tile-style dip

        // World-space smooth value noise — used to wobble the closed-edge
        // margin width *continuously along the edge's world coordinate*, so
        // the dirt/grass line meanders in long, smooth curves (serpentine,
        // like a worn footpath) instead of either a dead-straight band or
        // independent per-tile random teeth (which would just look like
        // sawtooth noise, not a winding path). Because it's keyed off world
        // position rather than per-tile randomness, the wave lines up
        // seamlessly across adjacent path tiles.
        const hash1 = n => {
          let h = (Math.imul(n | 0, 2654435761) ^ ((n | 0) << 13)) >>> 0;
          h = Math.imul(h ^ h>>>15, 1274126177) >>> 0;
          return (h >>> 0) / 4294967296;
        };
        const smooth = t => t * t * (3 - 2 * t);
        const wobble = (coord, seedOff) => {
          const WAVELEN = 3.4;  // ~3-4 tiles per S-curve — reads as serpentine, not jittery
          const xs = coord / WAVELEN + seedOff;
          const xi = Math.floor(xs), t = xs - xi;
          const a = hash1(xi), b = hash1(xi + 1);
          const v = a + (b - a) * smooth(t);       // 0..1 smooth value noise
          return 0.35 + v * 1.3;                    // multiplier range ~0.35..1.65
        };

        const openN = srcGrid[row - 1]?.[col]?.type === TileType.PATH;
        const openS = srcGrid[row + 1]?.[col]?.type === TileType.PATH;
        const openW = srcGrid[row]?.[col - 1]?.type === TileType.PATH;
        const openE = srcGrid[row]?.[col + 1]?.type === TileType.PATH;

        // Diagonal tiles — used to bevel the inner corner of L-shaped turns
        // instead of leaving a blocky right-angle notch (same technique as
        // buildTerrainTileGeo's TRENCH/RAISED corners).
        const diagNW = srcGrid[row-1]?.[col-1]?.type === TileType.PATH;
        const diagNE = srcGrid[row-1]?.[col+1]?.type === TileType.PATH;
        const diagSW = srcGrid[row+1]?.[col-1]?.type === TileType.PATH;
        const diagSE = srcGrid[row+1]?.[col+1]?.type === TileType.PATH;

        const seamDisp = (vx, vz) => {
          const kx = Math.round(vx * 2) | 0, kz = Math.round(vz * 2) | 0;
          let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
          h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
          return (h / 4294967296 - 0.5) * 0.026;
        };

        // Extra roughness along the path edge — stronger than trench to get ragged border
        const roughDisp = (vx, vz) => {
          const kx = Math.round(vx * 7) | 0, kz = Math.round(vz * 7) | 0;
          let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
          h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
          return (h / 4294967296 - 0.5) * 0.045;
        };

        // Isolated 1-tile corner "nubs" — both perpendicular neighbors are
        // path, the far diagonal isn't, AND the other two sides are closed —
        // are almost always a one-tile width-step along a wider road's edge,
        // not an intentional junction. Those get a true 45° diagonal cut
        // across the whole tile (literally half path / half grass) instead
        // of just a small rounded nub, so a multi-tile-wide road's outer
        // edge reads as a chamfered line rather than a sawtooth staircase.
        // Real junctions (where another side is also open) keep the subtle
        // small-radius diagonal trim so they don't get chopped in half.
        const isCornerNW = openW && openN && !diagNW && !openS && !openE;
        const isCornerNE = openE && openN && !diagNE && !openS && !openW;
        const isCornerSW = openW && openS && !diagSW && !openN && !openE;
        const isCornerSE = openE && openS && !diagSE && !openN && !openW;
        const spanNW = isCornerNW ? CELLS : BLEND_V;
        const spanNE = isCornerNE ? CELLS : BLEND_V;
        const spanSW = isCornerSW ? CELLS : BLEND_V;
        const spanSE = isCornerSE ? CELLS : BLEND_V;

        const Y = new Float32Array(VERTS * VERTS);
        for (let vj = 0; vj < VERTS; vj++) {
          for (let vi = 0; vi < VERTS; vi++) {
            const vx = col + vi * STEP, vz = row + vj * STEP;

            // Closed-edge margin wobbles smoothly along the edge's world
            // coordinate (vz for W/E, vx for N/S) — a long serpentine curve
            // rather than a per-tile-random tooth.
            const bW = openW ? 1 : smooth(Math.min(1, (vi / BLEND_V) * wobble(vz, 0.0)));
            const bE = openE ? 1 : smooth(Math.min(1, ((CELLS - vi) / BLEND_V) * wobble(vz, 17.3)));
            const bN = openN ? 1 : smooth(Math.min(1, (vj / BLEND_V) * wobble(vx, 41.7)));
            const bS = openS ? 1 : smooth(Math.min(1, ((CELLS - vj) / BLEND_V) * wobble(vx, 89.1)));

            // Diagonal bevel — Manhattan (vi+vj) distance from the corner,
            // whose iso-lines are true 45° diagonals (unlike max(vi,vj),
            // whose iso-lines are right-angle brackets).
            const bDiagNW = (openW && openN && !diagNW) ? smooth(Math.min(1, (vi + vj)                 / spanNW)) : 1;
            const bDiagNE = (openE && openN && !diagNE) ? smooth(Math.min(1, ((CELLS-vi) + vj)         / spanNE)) : 1;
            const bDiagSW = (openW && openS && !diagSW) ? smooth(Math.min(1, (vi + (CELLS-vj))         / spanSW)) : 1;
            const bDiagSE = (openE && openS && !diagSE) ? smooth(Math.min(1, ((CELLS-vi) + (CELLS-vj)) / spanSE)) : 1;

            const blend = Math.min(1, bW * bE * bN * bS * bDiagNW * bDiagNE * bDiagSW * bDiagSE);
            Y[vj * VERTS + vi] = seamDisp(vx, vz) + blend * PATH_DY + blend * roughDisp(vx, vz);
          }
        }

        // Split: path material where the depression is visible, grass at shallow edges
        const PATH_THRESH = -0.009;  // scaled with the shallower PATH_DY
        const pathIdx = [], grassIdx = [];
        for (let cj = 0; cj < CELLS; cj++)
          for (let ci = 0; ci < CELLS; ci++) {
            const v00=cj*VERTS+ci, v10=cj*VERTS+ci+1;
            const v01=(cj+1)*VERTS+ci, v11=(cj+1)*VERTS+ci+1;
            const isPath = Math.min(Y[v00], Y[v10], Y[v01], Y[v11]) < PATH_THRESH;
            (isPath ? pathIdx : grassIdx).push(v00, v01, v11, v00, v11, v10);
          }

        const positions = [];
        for (let vj = 0; vj < VERTS; vj++)
          for (let vi = 0; vi < VERTS; vi++)
            positions.push(vi * STEP - 0.5, Y[vj * VERTS + vi], vj * STEP - 0.5);

        const posAttr = new THREE.Float32BufferAttribute(positions, 3);

        // pathGeo and grassGeo share the position buffer along the wobbling
        // path/grass boundary — compute one normal set over both face lists
        // so the boundary shades continuously instead of each geometry only
        // seeing its own half of the faces.
        const normAttr = new THREE.Float32BufferAttribute(
          _sharedSplitNormals(positions, VERTS * VERTS, pathIdx, grassIdx), 3);

        const makeGeo = idx => {
          if (!idx.length) return null;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', posAttr);
          g.setAttribute('normal', normAttr);
          g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
          return g;
        };
        return { pathGeo: makeGeo(pathIdx), grassGeo: makeGeo(grassIdx) };
      }

      // Shared helper: compute one normal per vertex from a combined face list
      // (used so two split geometries that share a position buffer along a
      // boundary — e.g. path/grass — shade continuously instead of each
      // computing normals only from its own half of the faces).
      function _sharedSplitNormals(positions, vertCount, idxA, idxB) {
        const allIdx = idxA.concat(idxB);
        const normals = new Float32Array(vertCount * 3);
        for (let f = 0; f < allIdx.length; f += 3) {
          const ia = allIdx[f], ib = allIdx[f+1], ic = allIdx[f+2];
          const ax=positions[ia*3],ay=positions[ia*3+1],az=positions[ia*3+2];
          const bx=positions[ib*3],by=positions[ib*3+1],bz=positions[ib*3+2];
          const cx=positions[ic*3],cy=positions[ic*3+1],cz=positions[ic*3+2];
          const e1x=bx-ax,e1y=by-ay,e1z=bz-az, e2x=cx-ax,e2y=cy-ay,e2z=cz-az;
          const nx=e1y*e2z-e1z*e2y, ny=e1z*e2x-e1x*e2z, nz=e1x*e2y-e1y*e2x;
          for (const vi3 of [ia,ib,ic]) {
            normals[vi3*3] += nx; normals[vi3*3+1] += ny; normals[vi3*3+2] += nz;
          }
        }
        for (let v = 0; v < vertCount; v++) {
          const nx=normals[v*3], ny=normals[v*3+1], nz=normals[v*3+2];
          const len = Math.hypot(nx,ny,nz) || 1;
          normals[v*3]=nx/len; normals[v*3+1]=ny/len; normals[v*3+2]=nz/len;
        }
        return normals;
      }

      // ── Path network: one continuous heightfield for the whole road system ───
      // Instead of treating each PATH tile as its own flat, regular slab and
      // patching the seams between them, the entire path network (bounding box
      // of all PATH tiles + a margin) is built as ONE shared vertex grid — the
      // same "no per-tile independence" approach the border terrain uses beyond
      // the map's edge. A blurred per-tile mask defines where the ground dips
      // into the path, so the path/grass boundary settles into an organic,
      // irregular line that ignores the tile grid, and the dip itself reads as
      // a very shallow inverted cliff rather than a Minecraft-style flat block.
      // TRENCH/RAISED/SHRUB/ROCK tiles inside the bbox are left to their own
      // per-tile geometry (skipped here) so they aren't double-covered.
      function buildPathNetworkGeo(srcGrid, gcols, grows) {
        let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
        for (let r = 0; r < grows; r++)
          for (let c = 0; c < gcols; c++)
            if (srcGrid[r]?.[c]?.type === TileType.PATH) {
              if (c < minC) minC = c; if (c > maxC) maxC = c;
              if (r < minR) minR = r; if (r > maxR) maxR = r;
            }
        if (minC === Infinity) return null; // no path tiles at all

        const MARGIN = 2; // tiles of grass apron around the network for the dip to settle into
        minC = Math.max(0, minC - MARGIN); maxC = Math.min(gcols - 1, maxC + MARGIN);
        minR = Math.max(0, minR - MARGIN); maxR = Math.min(grows - 1, maxR + MARGIN);
        const bw = maxC - minC + 1, bh = maxR - minR + 1;

        const CELLS = 6, STEP = 1 / CELLS;
        const GW = bw * CELLS + 1, GH = bh * CELLS + 1;

        const EXCLUDED = new Set([TileType.TRENCH, TileType.RAISED, TileType.SHRUB, TileType.ROCK, TileType.TILLED, TileType.RIVER, TileType.STREAM]);
        const cellType    = (ci, cj) => srcGrid[minR + cj]?.[minC + ci]?.type;
        const isPathCell  = (ci, cj) => cellType(ci, cj) === TileType.PATH;
        const isExcluded  = (ci, cj) => EXCLUDED.has(cellType(ci, cj));

        // Vertices on a tile boundary touch 2 (edge) or 4 (corner) cells —
        // average their path-membership so the mask starts as a clean 0 /
        // 0.25 / 0.5 / 0.75 / 1 step instead of guessing a single owner cell.
        const touching = (g, n) => {
          if (g % CELLS === 0) {
            const a = g / CELLS - 1, b = g / CELLS, arr = [];
            if (a >= 0 && a < n) arr.push(a);
            if (b >= 0 && b < n) arr.push(b);
            return arr;
          }
          return [Math.floor(g / CELLS)];
        };

        let mask = new Float32Array(GW * GH);
        for (let gj = 0; gj < GH; gj++) {
          const rows = touching(gj, bh);
          for (let gi = 0; gi < GW; gi++) {
            const cols = touching(gi, bw);
            let sum = 0, n = 0;
            for (const cj of rows) for (const ci of cols) { n++; if (isPathCell(ci, cj)) sum++; }
            mask[gj * GW + gi] = n ? sum / n : 0;
          }
        }

        // Box-blur the mask a few times to round it into an organic, non-grid
        // boundary — this is what gives the rim its "more complex/defineable"
        // character instead of a tile-square hole.
        for (let pass = 0; pass < 3; pass++) {
          const next = new Float32Array(GW * GH);
          for (let gj = 0; gj < GH; gj++)
            for (let gi = 0; gi < GW; gi++) {
              let sum = 0, n = 0;
              for (let dj = -1; dj <= 1; dj++)
                for (let di = -1; di <= 1; di++) {
                  const ni = gi+di, nj = gj+dj;
                  if (ni<0||ni>=GW||nj<0||nj>=GH) continue;
                  sum += mask[nj*GW+ni]; n++;
                }
              next[gj*GW+gi] = sum / n;
            }
          mask = next;
        }

        const seamDisp = (vx, vz) => {
          const kx = Math.round(vx * 2) | 0, kz = Math.round(vz * 2) | 0;
          let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
          h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
          return (h / 4294967296 - 0.5) * 0.026;
        };
        const roughDisp = (vx, vz) => {
          const kx = Math.round(vx * 7) | 0, kz = Math.round(vz * 7) | 0;
          let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
          h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
          return (h / 4294967296 - 0.5) * 0.045;
        };
        const smooth = t => t * t * (3 - 2 * t);
        const PATH_DY = -0.05; // shallow — a worn groove, not a trench

        const Y = new Float32Array(GW * GH);
        const positions = new Float32Array(GW * GH * 3);
        for (let gj = 0; gj < GH; gj++)
          for (let gi = 0; gi < GW; gi++) {
            const vx = minC + gi * STEP, vz = minR + gj * STEP;
            const blend = smooth(Math.min(1, Math.max(0, mask[gj*GW+gi])));
            const y = seamDisp(vx, vz) + blend * PATH_DY + blend * roughDisp(vx, vz);
            const k = gj*GW+gi;
            Y[k] = y;
            positions[k*3] = vx; positions[k*3+1] = y; positions[k*3+2] = vz;
          }

        const PATH_THRESH = -0.013; // tuned for PATH_DY=-0.05 after the blur softens the mask
        const pathIdx = [], grassIdx = [];
        for (let cj = 0; cj < GH-1; cj++)
          for (let ci = 0; ci < GW-1; ci++) {
            const tci = Math.min(bw-1, Math.floor(ci / CELLS));
            const tcj = Math.min(bh-1, Math.floor(cj / CELLS));
            if (isExcluded(tci, tcj)) continue; // left for that tile's own geometry
            const v00=cj*GW+ci, v10=cj*GW+ci+1, v01=(cj+1)*GW+ci, v11=(cj+1)*GW+ci+1;
            const isPath = Math.min(Y[v00],Y[v10],Y[v01],Y[v11]) < PATH_THRESH;
            (isPath ? pathIdx : grassIdx).push(v00, v01, v11, v00, v11, v10);
          }

        const vertCount = GW * GH;
        const posAttr  = new THREE.Float32BufferAttribute(positions, 3);
        const normAttr = new THREE.Float32BufferAttribute(
          _sharedSplitNormals(positions, vertCount, pathIdx, grassIdx), 3);

        const makeGeo = idx => {
          if (!idx.length) return null;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', posAttr);
          g.setAttribute('normal', normAttr);
          g.setIndex(new THREE.BufferAttribute(
            vertCount > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
          return g;
        };

        return {
          pathGeo: makeGeo(pathIdx),
          grassGeo: makeGeo(grassIdx),
          inBounds: (c, r) => c >= minC && c <= maxC && r >= minR && r <= maxR,
          isExcludedTile: (c, r) => EXCLUDED.has(srcGrid[r]?.[c]?.type),
        };
      }

      // ── Rock tile: mini plateau heightfield (same pipeline as border terrain) ───
      // 9×9 vertex grid (0.125u steps) over a 1×1 tile. Uses seam-safe FNV hash
      // at tile edges so vertices match adjacent makeFloorGeo tiles exactly.
      function buildRockTileGeo(col, row) {
        const VERTS = 7, CELLS = 6;
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
        const maxSize = 2 + Math.floor(rng() * 12);  // scaled for the smaller CELLS=6 interior
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
      function buildTerrainTileGeo(col, row, type, srcGrid = grid) {
        const VERTS = 7, CELLS = 6, STEP = 1.0 / CELLS;
        const BLEND_V  = 2;
        const PLATEAU  = type === TileType.RAISED ? 3.0 : 1.5;  // raised = wide flat top
        const depressionTop = DEPRESSION_TOP[type];
        const isDepression = depressionTop !== undefined;
        const targetDY = isDepression
          ? depressionTop - NORMAL_TOP
          : RAISED_TOP - NORMAL_TOP;  // +0.5

        const openN = sameWaterway(srcGrid[row - 1]?.[col]?.type, type);
        const openS = sameWaterway(srcGrid[row + 1]?.[col]?.type, type);
        const openW = sameWaterway(srcGrid[row]?.[col - 1]?.type, type);
        const openE = sameWaterway(srcGrid[row]?.[col + 1]?.type, type);

        // Diagonal tiles — used to seal the inner corner of L-shaped turns
        const diagNW = sameWaterway(srcGrid[row-1]?.[col-1]?.type, type);
        const diagNE = sameWaterway(srcGrid[row-1]?.[col+1]?.type, type);
        const diagSW = sameWaterway(srcGrid[row+1]?.[col-1]?.type, type);
        const diagSE = sameWaterway(srcGrid[row+1]?.[col+1]?.type, type);

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
            const isDirt = isDepression
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

      // Town border terrain: same plateau-growth pipeline as the farm's
      // buildBorderTerrain(), but dramatic cliffs (passes 2+3) are restricted
      // to north/west/east — the south already reads as forest and is left
      // low/rolling — and the north/west/east walls are notched with flat
      // "canyon" gaps wherever a road crosses that edge, so paths continue
      // unobstructed off the map instead of dead-ending into rock.
      let _townBorderGrassPoints = [];
      let townBorderGrassBillMesh = null;
      function _buildTownBorderGrassBillboards() {
        if (!grassBillboardMat) return;
        if (townBorderGrassBillMesh) { townScene.remove(townBorderGrassBillMesh); townBorderGrassBillMesh = null; }
        const pts = _townBorderGrassPoints;
        if (!pts.length) return;
        const BLADES = 6;
        townBorderGrassBillMesh = new THREE.InstancedMesh(_grassBladeGeo, grassBillboardMat, pts.length * BLADES * 2);
        townBorderGrassBillMesh.frustumCulled = false;
        townBorderGrassBillMesh.visible = s_grass;
        const dummy = new THREE.Object3D();
        let idx = 0;
        for (const { px, pz, py, seed } of pts) {
          const rand = _mbRng(seed);
          for (let b = 0; b < BLADES; b++) {
            const ox = (rand() - 0.5) * 0.7, oz = (rand() - 0.5) * 0.7;
            const w  = 0.16 + rand() * 0.10, h = 0.22 + rand() * 0.14;
            const rot = rand() * Math.PI;
            dummy.position.set(px + ox, py, pz + oz);
            dummy.rotation.set(0, rot, 0);
            dummy.scale.set(w, h, 1);
            dummy.updateMatrix();
            townBorderGrassBillMesh.setMatrixAt(idx++, dummy.matrix);
            dummy.rotation.set(0, rot + Math.PI * 0.5, 0);
            dummy.updateMatrix();
            townBorderGrassBillMesh.setMatrixAt(idx++, dummy.matrix);
          }
        }
        townBorderGrassBillMesh.count = idx;
        townBorderGrassBillMesh.instanceMatrix.needsUpdate = true;
        townScene.add(townBorderGrassBillMesh);
      }

      function buildTownBorderTerrain() {
        const TCOLS = _townZone?.cols || 60, TROWS = _townZone?.rows || 50;
        const BORDER_W    = 18;
        const SEED        = 4077;
        const BLEND_STEPS = 8;

        const BV  = BORDER_W * 2;
        const PVW = TCOLS * 2, PVH = TROWS * 2;
        const GW  = PVW + 2*BV + 1;
        const GH  = PVH + 2*BV + 1;
        const CW  = GW - 1, CH = GH - 1;

        let _s = SEED >>> 0;
        const rng = () => {
          _s += 0x6D2B79F5;
          let t = Math.imul(_s ^ _s>>>15, _s|1);
          t ^= t + Math.imul(t ^ t>>>7, t|61);
          return ((t ^ t>>>14) >>> 0) / 4294967296;
        };

        const hashDisp = (vi, vj) => {
          let h = (2166136261 ^ (vi * 374761393) ^ (vj * 668265263)) >>> 0;
          h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
          return (h / 4294967296 - 0.5) * 0.026;
        };

        const vSteps = (gi, gj) => {
          const vi = gi - BV, vj = gj - BV;
          const dx = Math.max(0, -vi, vi - PVW);
          const dz = Math.max(0, -vj, vj - PVH);
          return Math.sqrt(dx*dx + dz*dz);
        };

        const isPlayable = (ci, cj) => ci>=BV && ci<BV+PVW && cj>=BV && cj<BV+PVH;

        const Y = new Float32Array(GW * GH);
        for (let gj = 0; gj < GH; gj++)
          for (let gi = 0; gi < GW; gi++)
            Y[gj*GW+gi] = NORMAL_TOP + hashDisp(gi-BV, gj-BV);

        const cv4 = (ci, cj) => [cj*GW+ci, cj*GW+ci+1, (cj+1)*GW+ci, (cj+1)*GW+ci+1];

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

        function raiseGroup(group, amount) {
          let maxY = -Infinity;
          const verts = new Set();
          for (const [ci,cj] of group)
            for (const vi of cv4(ci,cj)) { verts.add(vi); if(Y[vi]>maxY) maxY=Y[vi]; }
          const target = maxY + amount;
          for (const vi of verts) {
            const gi = vi%GW, gj = vi/GW|0;
            const st = vSteps(gi, gj);
            if (st === 0) continue;
            const blend  = Math.min(1, st / BLEND_STEPS);
            const raised = NORMAL_TOP + hashDisp(gi-BV, gj-BV) + blend*(target - NORMAL_TOP);
            if (raised > Y[vi]) Y[vi] = raised;
          }
        }

        // Edge-biased seed cell picker restricted to a set of sides
        // (0=north,1=south,2=west,3=east).
        function pickCell(outerBias, sides) {
          const rim = BV >> 2;
          for (let attempt = 0; attempt < 300; attempt++) {
            let ci, cj;
            if (rng() < outerBias) {
              const side = sides[Math.floor(rng() * sides.length)];
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

        // Pass 1: rugged plain on all four sides — keeps the south's forest
        // floor gently uneven too, with no dramatic height.
        for (let p = 0; p < 55; p++) {
          const [ci,cj] = pickCell(0.12, [0,1,2,3]);
          raiseGroup(pickGroup(ci, cj, 4 + Math.floor(rng()*18)), 0.05 + rng()*0.32);
        }

        // Pass 2: distant cliffs — tall, edge-biased plateaus, north/west/east
        // only (side 1 = south is excluded so it stays low).
        const cliffGroups = [];
        for (let p = 0; p < 32; p++) {
          const [ci,cj] = pickCell(0.88, [0,2,3]);
          const group = pickGroup(ci, cj, 10 + Math.floor(rng()*38));
          raiseGroup(group, 0.9 + rng()*3.2);
          cliffGroups.push(group);
        }

        // Pass 2b: sub-plateauing — stack smaller, taller shelves onto the
        // cliffs just raised (seeded from a random cell of the parent group,
        // free to spill past its footprint) so tops break up into irregular,
        // stepped terraces instead of flat single-height mesas. Two rounds
        // of decreasing scale add coarse-then-fine jaggedness.
        let subGroups = cliffGroups;
        for (const [count, sizeRange, amtRange] of [[3, [3, 17], [0.4, 2.2]], [2, [2, 8], [0.2, 1.0]]]) {
          const next = [];
          for (const group of subGroups) {
            const n = 1 + Math.floor(rng() * count);
            for (let s = 0; s < n; s++) {
              const [sci, scj] = group[Math.floor(rng() * group.length)];
              const sub = pickGroup(sci, scj, sizeRange[0] + Math.floor(rng() * (sizeRange[1] - sizeRange[0])));
              raiseGroup(sub, amtRange[0] + rng() * (amtRange[1] - amtRange[0]));
              next.push(sub);
            }
          }
          subGroups = next;
        }

        // Pass 3: guarantee a continuous cliff wall on north/west/east, with
        // canyon gaps cut through wherever a road crosses that edge. The
        // minimum ridge height itself is noisy (chunky, block-quantized) so
        // the skyline isn't a dead-flat shelf.
        const RIM_V   = 20;
        const ridgeNoise = (gi, gj) => {
          const qi = Math.round(gi / 5), qj = Math.round(gj / 5);
          let h = (2166136261 ^ (qi * 374761393) ^ (qj * 668265263)) >>> 0;
          h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
          return (h >>> 0) / 4294967296;
        };
        const rimMinAt = (gi, gj) => NORMAL_TOP + 2.2 + ridgeNoise(gi, gj) * 3.2;

        // Tile col/row range -> vertex-index range (half-open), matching the
        // 0.5-unit vertex spacing used throughout this generator.
        const toViRange = (a, b) => [BV + a*2, BV + (b+1)*2];
        const NORTH_GAP = toViRange(25, 35);   // sp_town_north  (col 30, row 1)
        const WEST_GAP  = toViRange(20, 30);   // spot_2vsub     (col 0,  row 25)
        const EAST_GAP  = toViRange(20, 30);   // spot_d33e9     (col 59, row 25)

        for (let gj = 0; gj < GH; gj++) {
          for (let gi = 0; gi < GW; gi++) {
            const nearN = gj < RIM_V;
            const nearS = gj > GH-1-RIM_V;
            const nearW = gi < RIM_V;
            const nearE = gi > GW-1-RIM_V;
            if (!nearN && !nearW && !nearE) continue;  // south-only or interior — stays low
            if (nearN && !nearW && !nearE && gi >= NORTH_GAP[0] && gi < NORTH_GAP[1]) continue;
            if (nearW && !nearN && !nearS && gj >= WEST_GAP[0]  && gj < WEST_GAP[1])  continue;
            if (nearE && !nearN && !nearS && gj >= EAST_GAP[0]  && gj < EAST_GAP[1])  continue;
            const k = gj * GW + gi;
            const rimMin = rimMinAt(gi, gj);
            if (Y[k] < rimMin) Y[k] = rimMin;
          }
        }

        // Carve the canyons clean through — full border depth on that side,
        // regardless of anything passes 1/2 piled up in the corridor — so
        // each road always has an open, flat path off the map edge.
        const carve = (giMin, giMax, gjMin, gjMax) => {
          for (let gj = gjMin; gj < gjMax; gj++)
            for (let gi = giMin; gi < giMax; gi++)
              Y[gj*GW+gi] = NORMAL_TOP + hashDisp(gi-BV, gj-BV);
        };
        carve(NORTH_GAP[0], NORTH_GAP[1], 0,           BV);
        carve(0,             BV,         WEST_GAP[0],  WEST_GAP[1]);
        carve(BV + PVW,      GW - 1,     EAST_GAP[0],  EAST_GAP[1]);

        // ── Build geometry (border ring only — playable interior skipped) ──
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
        geo.setIndex(new THREE.BufferAttribute(
          (pos.length/3 > 65535) ? new Uint32Array(indices) : new Uint16Array(indices), 1));
        geo.computeVertexNormals();

        const mesh = new THREE.Mesh(geo, tileMats.grass);
        mesh.receiveShadow = true;
        townScene.add(mesh);

        // ── Stone cliff skin — north/west/east strips, plus the SW/SE corner
        // blocks where the west/east walls continue down to the south edge.
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
              const cnx = -0.5 * ((y10 + y11) - (y00 + y01));
              const cnz =  0.5 * ((y10 - y01) - (y11 - y00));
              if (cnx * cnx + cnz * cnz <= 0.194) continue;
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
          townScene.add(new THREE.Mesh(g, cliffMat));
        }

        elevStoneSkin(0,           BV,          0,           GW - 1);  // north strip (incl. NW/NE corners)
        elevStoneSkin(BV,          GH - 1 - BV, 0,           BV);       // west strip (middle)
        elevStoneSkin(BV,          GH - 1 - BV, GW - 1 - BV, GW - 1);   // east strip (middle)
        elevStoneSkin(GH - 1 - BV, GH - 1,      0,           BV);       // SW corner
        elevStoneSkin(GH - 1 - BV, GH - 1,      GW - 1 - BV, GW - 1);   // SE corner

        // ── Sparse billboard grass on the flatter cells of the new terrain
        // (skips steep cliff faces; denser on the gentle south/Pass-1 hills)
        _townBorderGrassPoints = [];
        for (let cj = 0; cj < CH; cj++) {
          for (let ci = 0; ci < CW; ci++) {
            if (isPlayable(ci, cj)) continue;
            if (vSteps(ci, cj) > 16) continue;   // only near the playable edge
            const y00=Y[cj*GW+ci],     y10=Y[cj*GW+ci+1];
            const y01=Y[(cj+1)*GW+ci], y11=Y[(cj+1)*GW+ci+1];
            const cnx = -0.5 * ((y10 + y11) - (y00 + y01));
            const cnz =  0.5 * ((y10 - y01) - (y11 - y00));
            if (cnx*cnx + cnz*cnz > 0.194) continue;   // cliff face — no grass
            const seed = (ci * 7919 + cj * 104173) >>> 0;
            // Halfway between the old (0.3, too sparse) and the first fix
            // (0.58, too dense) — sits between the inside and outside look.
            if (_mbRng(seed)() > 0.44) continue;
            const px = (ci-BV)*0.5 + 0.25, pz = (cj-BV)*0.5 + 0.25;
            const py = (y00+y10+y01+y11) / 4;
            _townBorderGrassPoints.push({ px, pz, py, seed });
          }
        }
        _buildTownBorderGrassBillboards();

        // ── Inaccessible shrubs continuing the forest belt south of the map
        // edge — purely decorative (no tile data out there), skipped over
        // the two road corridors so both south exits stay visually clear,
        // and skipped on the steep SW/SE corner cliff faces.
        if (window.FoliageGenerator) {
          const SOUTH_GAP_A = toViRange(15, 21);   // To Farm (col 18, row 49)
          const SOUTH_GAP_B = toViRange(27, 33);   // To Cloud Forest (col 30, row 49)
          const STEP = 4;   // 2-tile spacing — shrubs are heavy procedural meshes
          for (let cj = BV + PVH; cj < CH; cj += STEP) {
            const depth = cj - (BV + PVH);
            if (depth > 22) continue;   // ~11 tiles south of the map edge
            for (let ci = 0; ci < CW; ci += STEP) {
              if (ci >= SOUTH_GAP_A[0] && ci < SOUTH_GAP_A[1]) continue;
              if (ci >= SOUTH_GAP_B[0] && ci < SOUTH_GAP_B[1]) continue;
              const seed = (777 + ci * 7919 + cj * 104173) >>> 0;
              const r = _mbRng(seed);
              if (r() > 0.22) continue;   // sparse clusters
              const y00=Y[cj*GW+ci],     y10=Y[cj*GW+ci+1];
              const y01=Y[(cj+1)*GW+ci], y11=Y[(cj+1)*GW+ci+1];
              const cnx = -0.5 * ((y10 + y11) - (y00 + y01));
              const cnz =  0.5 * ((y10 - y01) - (y11 - y00));
              if (cnx*cnx + cnz*cnz > 0.194) continue;   // steep corner cliff — no shrub
              const px = (ci-BV)*0.5 + 0.25, pz = (cj-BV)*0.5 + 0.25;
              const py = (y00+y10+y01+y11) / 4;
              const vegGroup = window.FoliageGenerator.buildShrubMesh(1000 + ci, 1000 + cj);
              const sc = 1.6 + r() * 1.2;
              vegGroup.scale.set(sc, sc, sc);
              vegGroup.rotation.y = r() * Math.PI * 2;
              vegGroup.position.set(px, py, pz);
              townScene.add(vegGroup);
              _markOutline(vegGroup);
            }
          }
        }
      }

      const rockGeo   = new THREE.BoxGeometry(0.9, ROCK_H,  0.9);
      const waterGeo  = new THREE.PlaneGeometry(1.0, 1.0);
      waterGeo.rotateX(-Math.PI / 2);
      const reticleGeo = new THREE.BoxGeometry(1.0, 0.06, 1.0);

      // Flat circle indicator for dig/raise — torus baked horizontal
      const reticleCircleGeo = new THREE.TorusGeometry(0.28, 0.04, 8, 40);
      reticleCircleGeo.rotateX(-Math.PI / 2);
      const reticleCircleMesh = new THREE.Mesh(reticleCircleGeo, reticleIntenseMat);
      reticleCircleMesh.visible = false;

      // Floating ring for object highlights — torus baked horizontal, bobs + spins
      const reticleRingGeo = new THREE.TorusGeometry(0.38, 0.05, 8, 40);
      reticleRingGeo.rotateX(-Math.PI / 2);
      const reticleRingMat = new THREE.MeshBasicMaterial({ color: 0xffe588, transparent: true, opacity: 0.92 });
      const reticleRingMesh = new THREE.Mesh(reticleRingGeo, reticleRingMat);
      reticleRingMesh.visible = false;

      // Three wavy horizontal lines for hoe tile actions
      const _wavyLineMat = new THREE.LineBasicMaterial({ color: 0xffffc8, transparent: true, opacity: 0.95 });
      const reticleWavyGroup = new THREE.Group();
      for (let _wi = 0; _wi < 3; _wi++) {
        const _pts = [];
        for (let _j = 0; _j <= 28; _j++) {
          const _x = (_j / 28 - 0.5) * 0.72;
          const _z = (_wi - 1) * 0.17 + 0.07 * Math.sin(_j / 28 * 4 * Math.PI);
          _pts.push(new THREE.Vector3(_x, 0, _z));
        }
        reticleWavyGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(_pts), _wavyLineMat));
      }
      reticleWavyGroup.visible = false;

      // ── Mesh stores ───────────────────────────────────────────────
      // Tile meshes: indexed by row*COLS+col
      const tileMeshes  = new Array(ROWS * COLS).fill(null);
      const waterMeshes = new Array(ROWS * COLS).fill(null);
      // Sparse index of occupied waterMeshes slots, kept in sync by setWaterMesh(),
      // so the per-frame fast-path time-uniform update only visits live entries.
      const _waterActive = new Set();
      function setWaterMesh(i, val) {
        waterMeshes[i] = val;
        if (val) _waterActive.add(i); else _waterActive.delete(i);
      }

      // ── Town water (ditches fill with rain just like farm trenches) ────
      // Town tiles are keyed "col,row" (the town grid is independently sized
      // and isn't laid out in the farm's flat row*COLS+col mesh arrays).
      const townWaterMeshes = new Map();
      let _townWaterSimDirty = true;
      let _townFlowingTrenchTiles = [];
      // Static river/stream water-surface meshes built once in buildTownScene
      // (not part of the rain-fed water sim — rivers always flow).
      let _townRiverWaterMeshes = [];

      // ── Player root (Group — avatar plane attached after onboarding) ─
      const playerMesh = new THREE.Group();
      playerMesh.name = 'player_root';
      scene.add(playerMesh);
      const playerGroundShadow = makeCharacterGroundShadow('player_ground_shadow');
      scene.add(playerGroundShadow);
      // Logical facing angle — decoupled from playerMesh.rotation.y so sweep can
      // rotate the visual body without affecting movement/targeting math.
      let playerFacing = 0;
      // Pending tool action queued to fire at the strike phase of the current swing
      let pendingAction = null;
      let strikeFired   = false;

      // True while the primary action input (key/click/button) is physically held
      // down. Drives the multi-stage dig/fill charge below — releasing it, or
      // retargeting a different tile, mid-charge cancels the whole thing.
      let actionHeldDown = false;
      // Multi-stage charge in progress: digging a brand-new trench or filling an
      // existing one in. Each stage plays one tool swing (sized by digSpeed); the
      // action only actually happens once every stage completes uninterrupted.
      let chargeAction = null;
      // Digging a new trench alternates two animations across 4 stages: the dig
      // swing itself (lift & jab) and a reverse-hoe toss that lifts and throws
      // dirt out behind the player. Each pair shares one duration, ramping
      // from 1s+1s on the first rep down to 1/4s+1/4s on the final rep.
      const DIG_NEW_TRENCH_REP_DURATIONS = [1.0, 0.25];
      const DIG_NEW_TRENCH_STAGES = DIG_NEW_TRENCH_REP_DURATIONS.flatMap(dur => [
        { anim: 'thrust', dur },
        { anim: 'toss',   dur },
      ]);
      // Filling a trench back in plays a repeating 5-stage flourish: turn 45°
      // toward the camera and swing, turn back and strike again (no recoil),
      // then a paused 180° length-wise twist of the shovel out and back, and a
      // quick stance reset. Repeats 3x like the old plain fill swings did.
      const REFILL_TURN_ANGLE = Math.PI / 4;
      const REFILL_FLOURISH_REP = [
        { anim: 'refillTurnOut',    dur: 1.0  },
        { anim: 'refillStrikeBack', dur: 0.5  },
        { anim: 'refillTwistOut',   dur: 0.25 },
        { anim: 'refillTwistBack',  dur: 0.25 },
        { anim: 'refillReset',      dur: 0.15 },
      ];
      const FILL_TRENCH_STAGES = [...REFILL_FLOURISH_REP, ...REFILL_FLOURISH_REP, ...REFILL_FLOURISH_REP];

      // Forces a specific swing animation during a charge stage (e.g. the
      // reverse-hoe toss), overriding the tool's normal activeAnimStyle().
      let chargeAnimOverride = null;

      // Combat ability swing overrides (set by triggerWeaponSwingVisual's
      // opts, called from combat-*.js modules), kept separate from
      // chargeAnimOverride so farm tool charge-actions never collide with
      // them. anim picks which of updateToolMesh's existing per-style arcs
      // (thrust/sweep/chop) plays, regardless of the equipped weapon's own
      // default style — e.g. a quick jab always plays the thrust arc even
      // while wielding the hatchet. dirSign flips a sweep's rotation (and
      // mirrors the weapon sprite) for alternating forehand/backhand combo
      // steps. windupFrac/strikeFrac let each ability's own windupS/strikeS
      // ratio drive how much of the cosmetic swing is spent winding up vs
      // striking, instead of one fixed split for every attack. power scales
      // a thrust's reach/turn for an extra-telegraphed finishing hit. Cleared
      // automatically once the swing's toolSwingT runs out.
      let combatSwingAnim = null;
      let combatSwingSign = 1;
      let combatSwingWindupFrac = 0.16;
      let combatSwingStrikeFrac = 0.28;
      let combatSwingPower = 1;
      // True while a charge-and-release ability's windup is being held —
      // see triggerWeaponHoldVisual()/releaseWeaponSwingHold() below.
      let combatSwingHeld = false;
      // Per-ability post-strike pause, in seconds — set via opts.holdS on a
      // triggerWeaponSwingVisual/triggerWeaponHoldVisual call (a config knob
      // each ability's own file sets, not a built-in engine default). 0 means
      // "use the old proportional-to-what's-left hold" — see the HF
      // calculation in updateToolMesh below.
      let combatSwingHoldS = 0;
      // Optional full 6-channel pose ({neutral,windup,strike}, each
      // {x,y,z,pitch,yaw,bodyYaw}) authored in the attack-animation editor.
      // When set, updateToolMesh applies it generically instead of going
      // through anim's bespoke per-style formula — see the pose-driven
      // branch at the top of updateToolMesh's style if/else chain.
      let combatSwingPose = null;

      function getDigSpeedMultiplier() {
        return Math.max(0.01, player.digSpeed || 1);
      }

      // Collapses the separate Dig/Fill action slots into one contextual input:
      // whichever of the two the player has selected, resolve to whichever is
      // actually valid for the targeted tile. Dig (including redigging a shallow
      // trench) takes priority; fall back to fill only when dig isn't valid,
      // i.e. an already-full trench — so the same input digs or fills depending
      // on what's targeted, on desktop and mobile alike.
      function resolveDigFillAction(tool, action, reticle) {
        if (!((tool === 'shovel' || tool === 'pick') && (action === 'dig' || action === 'fill'))) return action;
        if (canUseAction(tool, 'dig', reticle.col, reticle.row)) return 'dig';
        if (canUseAction(tool, 'fill', reticle.col, reticle.row)) return 'fill';
        return action;
      }

      // Whether starting this tool/action right now would kick off a multi-stage
      // charge (new trench dig, or filling one in) rather than firing immediately.
      // Redigging an existing shallow trench is a normal single-tap swing instead.
      function wouldStartCharge(tool, action) {
        if (!((tool === 'shovel' || tool === 'pick') && (action === 'dig' || action === 'fill'))) return false;
        const reticle = getReticleTile();
        const resolved = resolveDigFillAction(tool, action, reticle);
        if (!canUseAction(tool, resolved, reticle.col, reticle.row)) return false;
        if (resolved === 'fill') return true; // canUseAction already required an existing trench
        const tile = getActiveGrid()[reticle.row][reticle.col];
        return tile.type !== TileType.TRENCH;
      }

      function startChargeAction(reticle, stages) {
        if (chargeAction) return;
        // Which way the refill flourish's camera-facing turn should rotate —
        // whichever side of "facing the camera" (angle 0) the player is
        // currently closer to, so the turn-out reads as a natural pivot.
        const turnDelta = angleDiff(0, playerFacing);
        const refillTurnSign = turnDelta === 0 ? 1 : Math.sign(turnDelta);
        chargeAction = { col: reticle.col, row: reticle.row, action: activeAction, tool: activeTool, stage: 0, stages, refillTurnSign };
        beginChargeStage();
      }

      function beginChargeStage() {
        if (!chargeAction) return;
        const stageDef = chargeAction.stages[chargeAction.stage];
        const dur = stageDef.dur / getDigSpeedMultiplier();
        toolSwingDur = dur;
        toolSwingT   = dur;
        strikeFired  = false;
        pendingAction = null;
        chargeAnimOverride = stageDef.anim || null;
      }

      // Plays the weapon's existing arm-swing mesh animation for durationS without
      // queuing a pendingAction — used by Combat ability modules that resolve their
      // own hit logic and just want the legacy swing's visual flourish to match.
      // opts: { anim: 'thrust'|'sweep'|'chop', dirSign: 1|-1, windupFrac, strikeFrac, power, holdS }
      // lets a combat ability pick the attack-shape its animation should use
      // (independent of the equipped weapon's own default style), how its own
      // windupS/strikeS split maps onto the cosmetic swing arc, a (thrust
      // only) reach/turn multiplier for an extra-telegraphed finisher, and an
      // explicit post-strike pause length in seconds (holdS).
      function triggerWeaponSwingVisual(durationS, opts = {}) {
        if (activeTool !== 'weapon') return;
        const windupFrac = opts.windupFrac ?? 0.16;
        const strikeFrac = opts.strikeFrac ?? 0.28;
        // Abilities that don't budget their own return-to-neutral tail
        // (strikeFrac === 1 — Charged Breaker, Flurry, Quick Attacks, Counter
        // Shield's riposte, and every non-finisher combo step) would otherwise
        // have combatSwingAnim clear (see the toolSwingT <= 0 check below)
        // the instant the strike lands, snapping playerMesh straight to
        // updatePlayerMesh's movement-facing default with zero easing — the
        // in-game equivalent of the editor's smooth eased return never
        // playing. Reserve a proportional tail here so every swing eases
        // back regardless of what the caller budgeted, the same way HF is
        // auto-derived from SF in updateToolMesh, without needing any
        // per-ability changes in the combat-*.js files. Callers that already
        // reserved their own returnS (strikeFrac < 1) are left untouched.
        const hasOwnReturn = strikeFrac < 0.999;
        const returnTailS = hasOwnReturn ? 0 : Math.max(0.12, durationS * 0.35);
        // Reserve an explicit post-strike hold (if this ability's config asked
        // for one) on top of whatever windup/strike/return it already
        // budgeted — additive, rather than carving it out of durationS, so
        // the windup/strike/return real-world timings stay exactly as
        // authored; the pause is just inserted between strike and return.
        const holdS = Math.max(0, opts.holdS || 0);
        const totalS = durationS + returnTailS + holdS;
        toolSwingDur = Math.max(0.05, totalS);
        toolSwingT = toolSwingDur;
        strikeFired = false;
        pendingAction = null;
        combatSwingAnim = opts.anim || null;
        combatSwingSign = opts.dirSign || 1;
        combatSwingWindupFrac = windupFrac * durationS / totalS;
        combatSwingStrikeFrac = strikeFrac * durationS / totalS;
        combatSwingPower = opts.power ?? 1;
        combatSwingPose = opts.pose || null;
        combatSwingHoldS = holdS;
        combatSwingHeld = false;
      }

      // Like triggerWeaponSwingVisual, but once the windup phase finishes
      // (progress reaches windupFrac) the swing freezes there — held at its
      // windup extreme — instead of continuing into the strike. Used by
      // charge-and-release abilities (e.g. Charged Breaker) so the windup
      // plays out while the button is held down, no matter how long that
      // ends up being, and call releaseWeaponSwingHold() on release to let
      // the already-elapsed countdown carry straight on into the strike and
      // return phases.
      function triggerWeaponHoldVisual(durationS, opts = {}) {
        triggerWeaponSwingVisual(durationS, opts);
        combatSwingHeld = true;
      }

      function releaseWeaponSwingHold() {
        combatSwingHeld = false;
      }

      // Abandons a held windup without playing the strike — e.g. the button
      // was released before the ability's minimum charge. Snaps the swing
      // back to its rest pose (progress 0, same as the start of any other
      // swing's windup) instead of carrying on into the strike.
      function cancelWeaponSwingHold() {
        combatSwingHeld = false;
        toolSwingT = 0;
      }

      function cancelChargeAction() {
        if (!chargeAction) return;
        chargeAction = null;
        toolSwingT = 0;
        chargeAnimOverride = null;
      }

      function completeChargeAction() {
        const { col, row, action, tool } = chargeAction;
        chargeAction = null;
        chargeAnimOverride = null;
        // Re-check permission at completion too (not just at charge-start) in
        // case a farmhand grant changes mid-charge.
        const _chargePermCategory = farmActionPermissionCategory(tool, action);
        if (_chargePermCategory && !hasFarmPermission(_chargePermCategory)) {
          const msg = "Only the farm's owner (or a granted farmhand) can do that here.";
          lastActionMessage = msg;
          showToast(msg, false);
          refreshActionBar();
          return;
        }
        const result = applyAction(tool, action, col, row);
        lastActionMessage = result.message;
        showToast(result.message, result.ok !== false);
        spawnActionParticles(col, row, action, result.ok !== false);
        debugLog(`${result.ok ? 'ok' : 'blocked'} ${action} @ c${col},r${row}: ${result.message}`);
        if (currentArea === 'farm') {
          recomputeWater(false);
          if (result.ok !== false) markTileDirty(col, row);
        }
        if (result.ok !== false) saveMemberWorldData();
        refreshActionBar();
      }

      // Advances the in-progress charge by one stage once its swing finishes,
      // or cancels it the moment the button is released or the target changes.
      function updateChargeAction() {
        if (!chargeAction) return;
        if (!actionHeldDown) { cancelChargeAction(); return; }
        const reticle = getReticleTile();
        if (reticle.col !== chargeAction.col || reticle.row !== chargeAction.row) { cancelChargeAction(); return; }
        if (toolSwingT > 0) return;
        chargeAction.stage++;
        if (chargeAction.stage >= chargeAction.stages.length) {
          completeChargeAction();
        } else {
          spawnActionParticles(chargeAction.col, chargeAction.row, chargeAction.action, true);
          beginChargeStage();
        }
      }

      // ── Reticle mesh ──────────────────────────────────────────────
      const reticleMesh = new THREE.Mesh(reticleGeo, reticleMat);
      scene.add(reticleMesh);
      scene.add(reticleCircleMesh);
      scene.add(reticleRingMesh);
      scene.add(reticleWavyGroup);

      // ── Tool meshes (PNG sprite planes) ──────────────────────────────
      // toolSwingT counts down from toolSwingDur; progress = 1 - t/dur (0→1→0 arc).
      // Per-tool swing durations: thrust fast, chop medium, sweep slow.
      let toolSwingT   = 0;
      let toolSwingDur = 0.22;
      // Set true for the duration of a fishing-spear throw swing so updateToolMesh
      // flies the harpoon mesh out to the water anchor instead of slamming in place.
      let fishThrowActive = false;
      // Full rotations a "spinning" harpoon sprite (e.g. the fishing mace) twirls through over
      // one complete swing; spear-mode harpoon items leave their `spinning` flag false/unset.
      const TOOL_SPIN_REVOLUTIONS = 2.5;

      // Reference width in world units; height is derived from the image's aspect ratio,
      // matching the pattern used by buildAnimalPlaneAvatarModel (modelWidth × h/w).
      const TOOL_MODEL_WIDTH = 0.5;

      // Preload tool sprite textures; capture pixel dimensions on load and rebuild meshes
      const _toolTexLoader = new THREE.TextureLoader();
      const toolTextures = {};
      for (const [key, def] of Object.entries(TOOL_ITEM_DEFS)) {
        const tex = _toolTexLoader.load(def.sprite, (t) => {
          const img = t.image;
          def._imgW = img.naturalWidth  || img.width  || 1;
          def._imgH = img.naturalHeight || img.height || 1;
          // Rebuild with correct aspect ratio now that dimensions are known
          rebuildToolMeshes();
          const cur = toolMeshMap[activeTool];
          Object.values(toolMeshMap).forEach(m => { if (m) toolHolder.remove(m); });
          if (cur) toolHolder.add(cur);
        });
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        toolTextures[key] = tex;
      }

      // Build a PNG plane mesh sized to the sprite's pixel aspect ratio
      function makeToolPlaneMesh(itemKey) {
        if (!itemKey || !toolTextures[itemKey]) return null;
        const def  = TOOL_ITEM_DEFS[itemKey];
        const imgW = def?._imgW || 1;
        const imgH = def?._imgH || 1;
        const planeW = TOOL_MODEL_WIDTH;
        const planeH = planeW * (imgH / imgW);   // e.g. 450×1204 → 0.5 × 1.338
        const g   = new THREE.Group();
        const geo = new THREE.PlaneGeometry(planeW, planeH);
        const mat = new THREE.MeshBasicMaterial({
          map: toolTextures[itemKey],
          transparent: true,
          alphaTest: 0.08,
          side: THREE.DoubleSide,
        });
        const plane = new THREE.Mesh(geo, mat);
        plane.rotation.x = -Math.PI / 2;  // lie flat in XZ for all tools
        g.add(plane);
        // Keep a handle on the sprite plane so updateToolMesh can layer the sweep style's
        // blade-parallel twist and the mace-mode "spinning" twirl on top each frame, derived
        // from whichever anim is actually playing rather than baked in per-item here — see
        // updateToolMesh's baseRotZ for why.
        g.userData.toolPlane = plane;
        return g;
      }

      // Build/rebuild the toolMeshMap from currently equipped items
      const toolMeshMap = {};
      function rebuildToolMeshes() {
        // Remove old meshes from holder
        Object.values(toolMeshMap).forEach(m => { if (m) toolHolder.remove(m); });
        for (const slot of Object.keys(toolActions)) {
          const itemKey = equipmentSlots[slot] ?? null;
          toolMeshMap[slot] = itemKey ? makeToolPlaneMesh(itemKey) : null;
        }
        // machete alias → weapon mesh for legacy code paths
        if (!toolMeshMap.machete) toolMeshMap.machete = toolMeshMap.weapon;
        // Re-attach active tool
        if (toolMeshMap[activeTool]) toolHolder.add(toolMeshMap[activeTool]);
      }

      const toolHolder = new THREE.Group();
      scene.add(toolHolder);

      // Pre-allocated objects to avoid per-frame GC in updateToolMesh
      const _tUp      = new THREE.Vector3(0, 1, 0);
      const _xAxis    = new THREE.Vector3(1, 0, 0); // tool-local pitch axis (thrust)
      const _zAxis    = new THREE.Vector3(0, 0, 1); // tool-local roll axis (pose-driven only)
      const _qFac     = new THREE.Quaternion();  // facing (+ bodyYaw) rotation
      const _qAnim    = new THREE.Quaternion();  // animation rotation
      const _qToolYaw = new THREE.Quaternion();  // tool's own local yaw twist (thrust)
      const _qRoll    = new THREE.Quaternion();  // tool's own local roll twist (pose-driven only)
      const _swAxis   = new THREE.Vector3();     // chop/tilt axis (player right in world)

      // Resolve anim style for the active tool from equipped item or fallback
      const _animStyleFallbackLogged = new Set();
      function activeAnimStyle() {
        const itemKey = equipmentSlots[activeTool] || equipmentSlots.weapon;
        const style = TOOL_ITEM_DEFS[itemKey]?.animStyle;
        if (!style && !_animStyleFallbackLogged.has(itemKey)) {
          _animStyleFallbackLogged.add(itemKey);
          window.__farmLog?.(`[combat] ${itemKey || '(no item)'}: no animStyle defined → fallback to 'thrust'`, 'warn');
        }
        return style || 'thrust';
      }

      // Four-phase neutral→windup→strike→hold→neutral interpolation, shared by
      // every pose channel (lateral/forward offsets, pitch/yaw/bodyYaw angles) —
      // mirrors the attack-animation editor's poseAt()/lerpPose() so game.js and
      // the editor's authored pose JSON describe the exact same motion. The
      // hold phase (sf→hf) dwells exactly at the strike value before easing
      // back to neutral, so an impact reads as a clean hit instead of
      // snapping straight into its recovery.
      function fourPhaseLerp(progress, wf, sf, hf, windupV, strikeV, neutralV = 0) {
        if (progress <= wf) return neutralV + (windupV - neutralV) * (progress / wf);
        if (progress <= sf) return windupV + (strikeV - windupV) * ((progress - wf) / (sf - wf));
        if (progress <= hf) return strikeV;
        return strikeV + (neutralV - strikeV) * ((progress - hf) / (1.0 - hf));
      }

      // Each tool style's natural at-rest pose (degrees for angle channels) —
      // must stay in sync with the attack-animation editor's STYLE_NEUTRAL_POSE
      // (docs/tools/attack-animation-editor/index.html). Used as the fallback
      // neutral for the pose-driven combat branch below when a step's own
      // pose.neutral doesn't specify a channel.
      const STYLE_NEUTRAL_POSE = {
        thrust: { x: 0,    y: 0,    z: 0,    pitch: 10.31, yaw: 0,   roll: 0,   bodyYaw: 0 },
        sweep:  { x: 0,    y: 0,    z: 0.16, pitch: 0,     yaw: 0,   roll: 0,   bodyYaw: 0 },
        chop:   { x: 0.03, y: 0.37, z: -0.01, pitch: -155, yaw: -79, roll: -82, bodyYaw: 2 },
      };

      function updateToolMesh(dt) {
        if (!toolMeshMap[activeTool]) { toolHolder.visible = false; return; }
        toolHolder.visible = true;

        // Use logical facing for game-logic vectors; sweep will additively rotate the body.
        const θ      = playerFacing;
        const rightX = -Math.cos(θ), rightZ =  Math.sin(θ);
        const fwdX   =  Math.sin(θ), fwdZ   =  Math.cos(θ);
        // True local +X → world transform (the same standard Three.js Y-rotation the
        // attack-animation editor's rig/toolBase hierarchy applies), used specifically
        // for placing playerToolBaseX (the hand-attach point) in world space — kept
        // distinct from rightX/rightZ above, which is rightX's negation and stays as-is
        // since it also feeds _swAxis (the toss/refill swings' tilt axis); flipping it
        // there would reverse those already-tuned raise/slam directions.
        const attachRightX =  Math.cos(θ), attachRightZ = -Math.sin(θ);

        // Swing progress 0→1 over toolSwingDur. While combatSwingHeld is set,
        // decay still runs up through the windup phase, then freezes once it
        // reaches the windup→strike boundary — holding the windup pose for as
        // long as the ability stays held — until releaseWeaponSwingHold()
        // clears the flag and lets the remaining strike/return time play out.
        let progress = 0;
        if (toolSwingT > 0) {
          if (combatSwingHeld) {
            const holdFloorT = toolSwingDur * (1 - combatSwingWindupFrac);
            toolSwingT = Math.max(holdFloorT, toolSwingT - dt);
          } else {
            toolSwingT = Math.max(0, toolSwingT - dt);
          }
          progress   = 1 - toolSwingT / toolSwingDur;
        }
        const swing = Math.sin(progress * Math.PI);

        _qFac.setFromAxisAngle(_tUp, θ);
        _swAxis.set(rightX, 0, rightZ);

        const anim = fishThrowActive ? 'chop' : (chargeAnimOverride || combatSwingAnim || activeAnimStyle());
        // Tool actions keep their original fixed 16%/28% split; combat
        // triggers use each ability's own windupS/strikeS ratio (set via
        // triggerWeaponSwingVisual's opts) so a heavily-telegraphed swing
        // (e.g. Cleave) visibly winds up longer than a snap jab.
        const WF = combatSwingAnim ? combatSwingWindupFrac : 0.16;
        const SF = combatSwingAnim ? combatSwingStrikeFrac : 0.28;
        // Hold the strike pose before easing back to neutral, instead of
        // snapping straight into the return lerp. When an ability's config
        // set an explicit holdS (combatSwingHoldS > 0, baked into toolSwingDur
        // by triggerWeaponSwingVisual), use that many real seconds so the
        // pause is consistent regardless of how brief its windup/strike
        // timing is; otherwise fall back to the old proportional-to-
        // what's-left formula (dig/fill/refill, and any combat swing that
        // didn't set holdS).
        const HF = (combatSwingAnim && combatSwingHoldS > 0)
          ? Math.min(0.99, SF + combatSwingHoldS / toolSwingDur)
          : Math.min(0.99, SF + (1 - SF) * 0.3);

        if (combatSwingAnim && combatSwingPose) {
          // POSE-DRIVEN COMBAT SWING — applies a full 7-channel pose authored
          // in the attack-animation editor generically, for any style, the
          // same way thrust's branch below already does by hand: x/z are
          // hand-relative lateral/forward offsets, y is vertical, pitch/yaw/roll
          // are the tool's own local tilt/twist/roll, and bodyYaw alone rotates
          // the whole character (matching the editor's applyPoseToRig()).
          // dirSign mirrors x/yaw/roll/bodyYaw — exactly the editor's flipPose()
          // convention — so a combo step can reuse another step's pose
          // un-mirrored or mirrored. power scales every channel's deviation
          // from its own neutral, for a heavier-telegraphed finisher,
          // without needing a dedicated bespoke formula per style.
          const pose = combatSwingPose;
          const styleNeutral = STYLE_NEUTRAL_POSE[anim] || STYLE_NEUTRAL_POSE.thrust;
          const neutral = { ...styleNeutral, ...(pose.neutral || {}) };
          const sign = combatSwingSign;
          const power = combatSwingPower;
          const scale = (ch, v) => neutral[ch] + ((v ?? neutral[ch]) - neutral[ch]) * power;
          const chan = (ch, mirror = false) => {
            const w = scale(ch, pose.windup?.[ch]) * (mirror ? sign : 1);
            const s = scale(ch, pose.strike?.[ch]) * (mirror ? sign : 1);
            const n = neutral[ch] * (mirror ? sign : 1);
            return fourPhaseLerp(progress, WF, SF, HF, w, s, n);
          };

          const x = chan('x', true);
          const y = chan('y');
          const z = chan('z');
          const pitchRad   = THREE.MathUtils.degToRad(chan('pitch'));
          const yawRad     = THREE.MathUtils.degToRad(chan('yaw', true));
          const rollRad    = THREE.MathUtils.degToRad(chan('roll', true));
          const bodyYawRad = THREE.MathUtils.degToRad(chan('bodyYaw', true));

          const vθ  = θ + bodyYawRad;
          const vRX =  Math.cos(vθ), vRZ = -Math.sin(vθ);
          const vFX =  Math.sin(vθ), vFZ =  Math.cos(vθ);

          playerMesh.rotation.y = vθ;
          _qFac.setFromAxisAngle(_tUp, vθ);
          _qToolYaw.setFromAxisAngle(_tUp, yawRad);
          _qAnim.setFromAxisAngle(_xAxis, pitchRad);
          _qRoll.setFromAxisAngle(_zAxis, rollRad);
          toolHolder.quaternion.copy(_qFac).multiply(_qToolYaw).multiply(_qAnim).multiply(_qRoll);
          toolHolder.position.set(
            playerMesh.position.x + vRX * (playerToolBaseX + x) + vFX * z,
            playerMesh.position.y + playerToolBaseY + y,
            playerMesh.position.z + vRZ * (playerToolBaseX + x) + vFZ * z
          );

        } else if (anim === 'thrust') {
          // THRUST — non-overextending jab authored as a full pose (lateral
          // offset, forward jab, pitch, tool yaw, and a whole-body bodyYaw
          // wind-up/follow-through), matching the attack-animation editor's
          // pose schema exactly: x/z/pitch/yaw are hand-relative (relative to
          // toolBase), bodyYaw alone rotates the whole character. Combat jabs
          // pull back farther than a normal tool jab (-0.40 vs -0.22) so the
          // windup itself reads as a clear "about to stab" tell; the strike
          // still arrives at the same +0.32 extension either way.
          // power scales reach/turn for an extra-telegraphed finisher (e.g. a
          // combo's final lunge) without needing its own bespoke anim branch.
          const power       = combatSwingAnim ? combatSwingPower : 1;
          const windupBack  = (combatSwingAnim ? -0.40 : -0.22) * power;
          const jabOff      = fourPhaseLerp(progress, WF, SF, HF, windupBack, 0.32 * power);
          const lateral     = fourPhaseLerp(progress, WF, SF, HF, 0, -0.23 * power);
          // Pitch's neutral matches its own windup value (10.31°) rather than
          // the other channels' implicit 0 — a thrust weapon rests at this
          // held-up tilt, drops to a near-flat 1° at the strike, then eases
          // back to the resting tilt instead of snapping flat.
          const pitchRad    = fourPhaseLerp(progress, WF, SF, HF, THREE.MathUtils.degToRad(10.31), THREE.MathUtils.degToRad(1), THREE.MathUtils.degToRad(10.31));
          const yawRad      = fourPhaseLerp(progress, WF, SF, HF, 0, THREE.MathUtils.degToRad(-45) * power);
          const bodyYawRad  = fourPhaseLerp(progress, WF, SF, HF, THREE.MathUtils.degToRad(-45) * power, THREE.MathUtils.degToRad(46) * power);

          const vθ  = θ + bodyYawRad;
          const vRX =  Math.cos(vθ), vRZ = -Math.sin(vθ);
          const vFX =  Math.sin(vθ), vFZ =  Math.cos(vθ);

          playerMesh.rotation.y = vθ;
          _qFac.setFromAxisAngle(_tUp, vθ);
          _qToolYaw.setFromAxisAngle(_tUp, yawRad);
          _qAnim.setFromAxisAngle(_xAxis, pitchRad);
          toolHolder.quaternion.copy(_qFac).multiply(_qToolYaw).multiply(_qAnim);
          toolHolder.position.set(
            playerMesh.position.x + vRX * (playerToolBaseX + lateral) + vFX * jabOff,
            playerMesh.position.y + playerToolBaseY,
            playerMesh.position.z + vRZ * (playerToolBaseX + lateral) + vFZ * jabOff
          );

        } else if (anim === 'chop') {
          // CHOP — full pose-driven swing (raise → slam → return), authored
          // in the attack-animation editor and baked in here exactly the way
          // thrust's branch above does: x/y/z/pitch/yaw/roll are hand-relative
          // (relative to toolBase), bodyYaw alone rotates the whole character.
          // Roll is what makes this read as a proper chop (head turned into
          // the swing plane) instead of the old single-axis raise/slam.
          // power scales every channel's deviation from its own neutral, just
          // like thrust, so Charged Breaker's heavier overhead (which also
          // plays this branch — see combat-charged-breaker.js) doesn't need
          // its own bespoke formula.
          const power   = combatSwingAnim ? combatSwingPower : 1;
          const neutral = { x: 0.03,  y: 0.37, z: -0.01, pitch: -155, yaw: -79, bodyYaw: 2,   roll: -82 };
          const windup  = { x: -0.18, y: 0.41, z: -0.15, pitch: -165, yaw: 13,  bodyYaw: -29, roll: -112 };
          const strike  = { x: 0,     y: 0,    z: 0.12,  pitch: 13,   yaw: -28, bodyYaw: 29,  roll: -91 };
          const scale = (ch, v) => neutral[ch] + (v - neutral[ch]) * power;
          const chanLerp = ch => fourPhaseLerp(progress, WF, SF, HF, scale(ch, windup[ch]), scale(ch, strike[ch]), neutral[ch]);

          const x = chanLerp('x');
          const y = chanLerp('y');
          const z = chanLerp('z');
          const pitchRad   = THREE.MathUtils.degToRad(chanLerp('pitch'));
          const yawRad     = THREE.MathUtils.degToRad(chanLerp('yaw'));
          const rollRad    = THREE.MathUtils.degToRad(chanLerp('roll'));
          const bodyYawRad = THREE.MathUtils.degToRad(chanLerp('bodyYaw'));

          const vθ  = θ + bodyYawRad;
          const vRX =  Math.cos(vθ), vRZ = -Math.sin(vθ);
          const vFX =  Math.sin(vθ), vFZ =  Math.cos(vθ);

          playerMesh.rotation.y = vθ;
          _qFac.setFromAxisAngle(_tUp, vθ);
          _qToolYaw.setFromAxisAngle(_tUp, yawRad);
          _qAnim.setFromAxisAngle(_xAxis, pitchRad);
          _qRoll.setFromAxisAngle(_zAxis, rollRad);
          toolHolder.quaternion.copy(_qFac).multiply(_qToolYaw).multiply(_qAnim).multiply(_qRoll);

          const handX = playerMesh.position.x + vRX * (playerToolBaseX + x) + vFX * z;
          const handY = playerMesh.position.y + playerToolBaseY + y;
          const handZ = playerMesh.position.z + vRZ * (playerToolBaseX + x) + vFZ * z;
          if (fishThrowActive && fishingMinigame?.anchorWorld) {
            // Out during the slam (WF→SF), held at the anchor through the
            // hold (SF→HF), back during the return (HF→1).
            let travel;
            if (progress <= WF) travel = 0;
            else if (progress <= SF) travel = (progress - WF) / (SF - WF);
            else if (progress <= HF) travel = 1;
            else travel = 1 - (progress - HF) / (1.0 - HF);
            const aw = fishingMinigame.anchorWorld;
            toolHolder.position.set(
              handX + (aw.x - handX) * travel,
              handY + (aw.y - handY) * travel,
              handZ + (aw.z - handZ) * travel
            );
          } else {
            toolHolder.position.set(handX, handY, handZ);
          }

        } else if (anim === 'toss') {
          // TOSS — reverse hoe: lift the load on the windup, then heave it up
          // and back over the shoulder on the strike to throw dirt out behind you.
          let tossAngle;
          if (progress <= WF) {
            tossAngle = -1.50 + 1.18 * (progress / WF);                // lift from a low scoop: −1.50 → −0.32
          } else if (progress <= SF) {
            tossAngle = -0.32 - 2.68 * ((progress - WF) / (SF - WF));  // heave up & over the shoulder: −0.32 → −3.00
          } else {
            tossAngle = -3.00 + 1.50 * ((progress - SF) / (1.0 - SF));// settle back to the low scoop: −3.00 → −1.50
          }
          _qAnim.setFromAxisAngle(_swAxis, tossAngle);
          toolHolder.quaternion.multiplyQuaternions(_qAnim, _qFac);
          toolHolder.position.set(
            playerMesh.position.x + attachRightX * playerToolBaseX,
            playerMesh.position.y + playerToolBaseY,
            playerMesh.position.z + attachRightZ * playerToolBaseX
          );

        } else if (anim === 'refillTurnOut') {
          // REFILL #1 — pivot up to 45° toward the camera while swinging the
          // basic shovel thrust (the same windup→jab→return as 'thrust').
          const sign = chargeAction?.refillTurnSign || 1;
          const rotAngle = progress <= WF
            ? REFILL_TURN_ANGLE * sign * (progress / WF)
            : REFILL_TURN_ANGLE * sign;
          let jabOff;
          if (progress <= WF) jabOff = -0.22 * (progress / WF);
          else if (progress <= SF) jabOff = -0.22 + 0.54 * ((progress - WF) / (SF - WF));
          else jabOff = 0.32 * (1.0 - (progress - SF) / (1.0 - SF));
          const vθ = θ + rotAngle;
          const vRX =  Math.cos(vθ), vRZ = -Math.sin(vθ);
          const vFX =  Math.sin(vθ), vFZ =  Math.cos(vθ);
          playerMesh.rotation.y = vθ;
          _qFac.setFromAxisAngle(_tUp, vθ);
          _qAnim.setFromAxisAngle(_swAxis, 0.18);
          toolHolder.quaternion.multiplyQuaternions(_qAnim, _qFac);
          toolHolder.position.set(
            playerMesh.position.x + vRX * playerToolBaseX + vFX * jabOff,
            playerMesh.position.y + playerToolBaseY,
            playerMesh.position.z + vRZ * playerToolBaseX + vFZ * jabOff
          );

        } else if (anim === 'refillStrikeBack') {
          // REFILL #2 — pivot back to face the trench, then strike with no
          // recoil: the jab holds at full extension instead of returning.
          const sign = chargeAction?.refillTurnSign || 1;
          let rotAngle, jabOff;
          if (progress <= WF) {
            rotAngle = REFILL_TURN_ANGLE * sign * (1 - progress / WF);
            jabOff   = -0.22 * (progress / WF);
          } else if (progress <= SF) {
            rotAngle = 0;
            jabOff   = -0.22 + 0.54 * ((progress - WF) / (SF - WF));
          } else {
            rotAngle = 0;
            jabOff   = 0.32;
          }
          const vθ = θ + rotAngle;
          const vRX =  Math.cos(vθ), vRZ = -Math.sin(vθ);
          const vFX =  Math.sin(vθ), vFZ =  Math.cos(vθ);
          playerMesh.rotation.y = vθ;
          _qFac.setFromAxisAngle(_tUp, vθ);
          _qAnim.setFromAxisAngle(_swAxis, 0.18);
          toolHolder.quaternion.multiplyQuaternions(_qAnim, _qFac);
          toolHolder.position.set(
            playerMesh.position.x + vRX * playerToolBaseX + vFX * jabOff,
            playerMesh.position.y + playerToolBaseY,
            playerMesh.position.z + vRZ * playerToolBaseX + vFZ * jabOff
          );

        } else if (anim === 'refillTwistOut' || anim === 'refillTwistBack') {
          // REFILL #3/#4 — held at full extension facing the trench; the
          // 180° length-wise twist itself is layered onto spinPlane below.
          playerMesh.rotation.y = θ;
          _qFac.setFromAxisAngle(_tUp, θ);
          _qAnim.setFromAxisAngle(_swAxis, 0.18);
          toolHolder.quaternion.multiplyQuaternions(_qAnim, _qFac);
          toolHolder.position.set(
            playerMesh.position.x + attachRightX * playerToolBaseX + fwdX * 0.32,
            playerMesh.position.y + playerToolBaseY,
            playerMesh.position.z + attachRightZ * playerToolBaseX + fwdZ * 0.32
          );

        } else if (anim === 'refillReset') {
          // REFILL #5 — quick stance reset: jab eases back to neutral.
          const jabOff = 0.32 * (1.0 - progress);
          playerMesh.rotation.y = θ;
          _qFac.setFromAxisAngle(_tUp, θ);
          _qAnim.setFromAxisAngle(_swAxis, 0.18);
          toolHolder.quaternion.multiplyQuaternions(_qAnim, _qFac);
          toolHolder.position.set(
            playerMesh.position.x + attachRightX * playerToolBaseX + fwdX * jabOff,
            playerMesh.position.y + playerToolBaseY,
            playerMesh.position.z + attachRightZ * playerToolBaseX + fwdZ * jabOff
          );

        } else {
          // SWEEP — body rotates through windup-strike-return arc; axe locked in hand.
          // -2.20/2.12 rad are exactly the attack-animation-editor's "Hatchet —
          // Swing (sweep)" preset (-126.05deg/121.49deg) — combo steps must match
          // that preset 1:1, so no extra scaling beyond dirSign/power applies here.
          // Combat swings alternate direction (forehand/backhand) via
          // combatSwingSign; power (Cleave) scales the whole arc for a heavier finisher.
          const sweepSign = combatSwingAnim ? combatSwingSign : 1;
          const sweepPower = combatSwingAnim ? combatSwingPower : 1;
          const WINDUP_ANGLE = -2.20 * sweepPower * sweepSign, STRIKE_ANGLE = 2.12 * sweepPower * sweepSign;
          let sweepOff;
          if (progress <= WF) {
            sweepOff = WINDUP_ANGLE * (progress / WF);
          } else if (progress <= SF) {
            sweepOff = WINDUP_ANGLE + (STRIKE_ANGLE - WINDUP_ANGLE) * ((progress - WF) / (SF - WF));
          } else if (progress <= HF) {
            sweepOff = STRIKE_ANGLE;
          } else {
            sweepOff = STRIKE_ANGLE * (1.0 - (progress - HF) / (1.0 - HF));
          }
          const vθ = θ + sweepOff;
          playerMesh.rotation.y = vθ;
          const vRX =  Math.cos(vθ), vRZ = -Math.sin(vθ);
          const vFX =  Math.sin(vθ), vFZ =  Math.cos(vθ);
          _qFac.setFromAxisAngle(_tUp, vθ);
          toolHolder.quaternion.copy(_qFac);
          // Backhand mirrors the hand attach point too (matching the editor's
          // "Flip Across Midline": toolBase.x negates along with bodyYaw and the
          // sprite scale) — a true mirror, not just the body spinning the other way.
          const handX = playerToolBaseX * sweepSign;
          toolHolder.position.set(
            playerMesh.position.x + vRX * handX + vFX * 0.16,
            playerMesh.position.y + playerToolBaseY,
            playerMesh.position.z + vRZ * handX + vFZ * 0.16
          );
        }

        // Layer the sprite's own "spinning" twirl on top of whichever swing style is active —
        // mace-mode harpoon items spin through the swing, spear-mode ones hold their rest pose.
        const spinItemKey = equipmentSlots[activeTool] || equipmentSlots.weapon;
        const spinPlane    = toolMeshMap[activeTool]?.userData?.toolPlane;
        if (spinPlane) {
          // The sweep style's blade-parallel z-twist belongs to whichever anim is actually
          // playing this frame, not whichever style the equipped item defaults to at rest —
          // combat abilities can force any style onto any weapon (a thrust-style quick
          // attack played on the sweep-styled hatchet, or a sweep combo step played on the
          // thrust-styled pick-shovel), so baking the twist per-item at mesh creation got it
          // backwards in either direction. Deriving it from `anim` here keeps it correct
          // regardless of what's equipped (and naturally drops to 0 during fishThrowActive,
          // since that always forces anim to 'chop').
          const baseRotZ = anim === 'sweep' ? -Math.PI / 2 : 0;
          if (anim === 'refillTwistOut') {
            // Lerp a 180° length-wise spin out, independent of any item's own "spinning" flag.
            spinPlane.rotation.z = baseRotZ + progress * Math.PI;
          } else if (anim === 'refillTwistBack') {
            // Reverse of the twist-out: lerp back from 180° to 0°.
            spinPlane.rotation.z = baseRotZ + Math.PI * (1 - progress);
          } else {
            // The mace's own fishing-throw twirl is cosmetic to the harpoon cast —
            // it shouldn't also layer onto combat swings when the same item is
            // equipped in the weapon slot, or every combo/quick-attack would
            // spin like a fishing throw instead of following its own anim arc.
            spinPlane.rotation.z = (TOOL_ITEM_DEFS[spinItemKey]?.spinning && !combatSwingAnim)
              ? baseRotZ - progress * Math.PI * 2 * TOOL_SPIN_REVOLUTIONS
              : baseRotZ;
          }
          // Backhand combat sweeps mirror the weapon sprite itself, not just the swing arc.
          spinPlane.scale.x = (anim === 'sweep' && combatSwingAnim) ? combatSwingSign : 1;
        }

        if (pendingAction && !strikeFired && progress >= SF) {
          strikeFired = true;
          firePendingAction();
        }
        if (fishThrowActive && toolSwingT <= 0) fishThrowActive = false;
        if (combatSwingAnim && toolSwingT <= 0) { combatSwingAnim = null; combatSwingPose = null; combatSwingHoldS = 0; }
      }

      // Initialize mesh map after toolHolder exists
      rebuildToolMeshes();



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
      // Sparse index of occupied vegFoliageMeshes slots, kept in sync by setVegFoliageMesh(),
      // so the per-frame wind-sway loop only visits live entries instead of all 936 slots.
      const _vegFoliageActive = new Set();
      function setVegFoliageMesh(i, val) {
        vegFoliageMeshes[i] = val;
        if (val) _vegFoliageActive.add(i); else _vegFoliageActive.delete(i);
      }

      // ── Grass billboard system (grass_1.png sprites on GRASS tiles) ─────────
      // Rendered via InstancedMesh (one draw call per category) instead of one
      // Mesh pair per blade — at 14 crosses × 2 blades per tile, a per-Mesh
      // approach would cost tens of thousands of draw calls across the farm's
      // WEEDS-majority default tile pattern, which is the real cause of janky
      // frame pacing during movement (not the per-tile speed multiplier).

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
          #ifdef USE_INSTANCING
            vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
          #else
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
          #endif
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
        uniform vec3 uLightColor;
        uniform float uLightMul;
        varying vec2 vUv;
        void main() {
          vec4 texel = texture2D(uGrassTex, vUv);
          if (texel.a < 0.5) discard;
          // Treat grass_1.png as mint-toned; desaturate and re-tint to grass color
          float lum = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
          // Same day/night ambient color+brightness driving the ground tiles'
          // Lambert shading, applied only to the tinted blade (not the outline)
          // so blades dim/tint with the world instead of staying flat-lit.
          vec3 tinted = uTint * (0.7 + lum * 0.8) * uLightColor * uLightMul;
          // Drawn outline pixels (near-black source) stay pure black; tint the rest
          vec3 col = mix(vec3(0.0), tinted, smoothstep(0.0, 0.15, lum));
          gl_FragColor = vec4(col, texel.a);
        }
      `;

      const _grassTint = new THREE.Color().setHSL(108 / 360, 0.58, 0.28);
      let grassBillboardMat = null;
      let cuttableBillboardGlowMat = null;
      let cuttableBillboardGlowMesh = null;

      new THREE.TextureLoader().load('assets/leaves/grass_1.png', (tex) => {
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        const sharedUniforms = () => ({
          uGrassTex:   { value: tex },
          uTint:       { value: _grassTint },
          uTime:       { value: 0 },
          uStrength:   { value: 0.04 },
          uLightColor: { value: new THREE.Color(1, 1, 1) },
          uLightMul:   { value: 1 },
        });
        grassBillboardMat = new THREE.ShaderMaterial({
          uniforms:       sharedUniforms(),
          vertexShader:   _grassBillVert,
          fragmentShader: _grassBillFrag,
          alphaTest: 0.5, side: THREE.DoubleSide, depthWrite: true,
        });
        cuttableBillboardGlowMat = new THREE.ShaderMaterial({
          uniforms: {
            uGrassTex: { value: tex },
            uColor: { value: new THREE.Color(combatConfig().cuttableTargetGlow?.color || '#ff2a1f') },
            uAlpha: { value: Number(combatConfig().cuttableTargetGlow?.alpha) || 0.42 }
          },
          vertexShader: _grassBillVert,
          fragmentShader: `
            uniform sampler2D uGrassTex;
            uniform vec3 uColor;
            uniform float uAlpha;
            varying vec2 vUv;
            void main() {
              vec4 texel = texture2D(uGrassTex, vUv);
              if (texel.a < 0.5) discard;
              gl_FragColor = vec4(uColor, uAlpha * texel.a);
            }
          `,
          transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        });
        _rebuildFarmBillboards();
        if (_townSceneBuilt) {
          _buildTownGrassBillboards(_townZone?.cols || 60, _townZone?.rows || 50);
          _buildTownBorderGrassBillboards();
        }
      });

      // Fills 14 crosses (28 blades) worth of instance matrices for one tile
      // into `mesh` starting at `startIdx`; returns the next free index.
      function _fillBillboardInstances(mesh, dummy, startIdx, col, row, sizeMul, yOffset = 0) {
        const rand  = _mbRng(((col * 31337 + row * 1009) >>> 0));
        const baseY = tileSurfaceY(TileType.GRASS) + yOffset;
        let idx = startIdx;
        for (let b = 0; b < 14; b++) {
          const ox  = (rand() - 0.5) * 0.9;
          const oz  = (rand() - 0.5) * 0.9;
          const w   = (0.16 + rand() * 0.10) * sizeMul;
          const h   = (0.22 + rand() * 0.14) * sizeMul;
          const rot = rand() * Math.PI;
          const px  = col + 0.5 + ox, pz = row + 0.5 + oz;

          dummy.position.set(px, baseY, pz);
          dummy.rotation.set(0, rot, 0);
          dummy.scale.set(w, h, 1);
          dummy.updateMatrix();
          mesh.setMatrixAt(idx++, dummy.matrix);

          dummy.rotation.set(0, rot + Math.PI * 0.5, 0);
          dummy.updateMatrix();
          mesh.setMatrixAt(idx++, dummy.matrix);
        }
        return idx;
      }

      function updateCuttableBillboardGlow(col, row, visible) {
        if (!cuttableBillboardGlowMesh || !cuttableBillboardGlowMat) return;
        if (!visible || combatConfig().cuttableTargetGlow?.enabled === false) {
          cuttableBillboardGlowMesh.count = 0;
          return;
        }
        cuttableBillboardGlowMat.uniforms.uColor.value.set(combatConfig().cuttableTargetGlow?.color || '#ff2a1f');
        cuttableBillboardGlowMat.uniforms.uAlpha.value = Number(combatConfig().cuttableTargetGlow?.alpha) || 0.42;
        const dummy = new THREE.Object3D();
        cuttableBillboardGlowMesh.count = _fillBillboardInstances(cuttableBillboardGlowMesh, dummy, 0, col, row, 2.0);
        cuttableBillboardGlowMesh.instanceMatrix.needsUpdate = true;
      }

      // Farm grass (GRASS tiles, gated by s_grass) and weeds (WEEDS tiles in
      // Mode A, always on) each get one InstancedMesh sized for the worst case
      // (every farm tile being that type), so edits just refill the buffer and
      // adjust .count rather than recreating the mesh.
      let farmGrassBillMesh = null, farmWeedBillMesh = null;
      function _ensureFarmBillboardMeshes() {
        if (farmGrassBillMesh) return;
        const cap = ROWS * COLS * 28;
        farmGrassBillMesh = new THREE.InstancedMesh(_grassBladeGeo, grassBillboardMat, cap);
        farmGrassBillMesh.frustumCulled = false;
        farmGrassBillMesh.count = 0;
        farmGrassBillMesh.visible = s_grass;
        scene.add(farmGrassBillMesh);

        farmWeedBillMesh = new THREE.InstancedMesh(_grassBladeGeo, grassBillboardMat, cap);
        farmWeedBillMesh.frustumCulled = false;
        farmWeedBillMesh.count = 0;
        scene.add(farmWeedBillMesh);

        cuttableBillboardGlowMesh = new THREE.InstancedMesh(_grassBladeGeo, cuttableBillboardGlowMat || grassBillboardMat, 28);
        cuttableBillboardGlowMesh.frustumCulled = false;
        cuttableBillboardGlowMesh.count = 0;
        scene.add(cuttableBillboardGlowMesh);
      }

      function _rebuildFarmBillboards() {
        if (!grassBillboardMat) return;
        _ensureFarmBillboardMeshes();
        const dummy = new THREE.Object3D();
        let gi = 0, wi = 0;
        for (let row = 0; row < ROWS; row++) {
          for (let col = 0; col < COLS; col++) {
            const tp = grid[row][col].type;
            if (tp === TileType.GRASS) {
              gi = _fillBillboardInstances(farmGrassBillMesh, dummy, gi, col, row, 1.0);
            } else if (tp === TileType.WEEDS && !s_weed3D) {
              wi = _fillBillboardInstances(farmWeedBillMesh, dummy, wi, col, row, 2.0);
            }
          }
        }
        farmGrassBillMesh.count = gi;
        farmWeedBillMesh.count  = wi;
        farmGrassBillMesh.instanceMatrix.needsUpdate = true;
        farmWeedBillMesh.instanceMatrix.needsUpdate  = true;
      }

      // Town's grass billboards — built once when entering town (town tiles
      // don't get tilled/cleared at runtime, so no per-tile rebuild needed).
      let townGrassBillMesh = null;
      function _buildTownGrassBillboards(tcols, trows) {
        if (!grassBillboardMat) return;
        if (townGrassBillMesh) { townScene.remove(townGrassBillMesh); townGrassBillMesh = null; }
        let count = 0;
        for (let row = 0; row < trows; row++)
          for (let col = 0; col < tcols; col++)
            if (townGrid[row]?.[col]?.type === TileType.GRASS) count++;
        if (count === 0) return;

        townGrassBillMesh = new THREE.InstancedMesh(_grassBladeGeo, grassBillboardMat, count * 28);
        townGrassBillMesh.frustumCulled = false;
        townGrassBillMesh.visible = s_grass;
        const dummy = new THREE.Object3D();
        let idx = 0;
        for (let row = 0; row < trows; row++) {
          for (let col = 0; col < tcols; col++) {
            if (townGrid[row]?.[col]?.type !== TileType.GRASS) continue;
            idx = _fillBillboardInstances(townGrassBillMesh, dummy, idx, col, row, 1.0);
          }
        }
        townGrassBillMesh.count = idx;
        townGrassBillMesh.instanceMatrix.needsUpdate = true;
        townScene.add(townGrassBillMesh);
      }

      function _rebuildWeedTiles() {
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++) {
            if (grid[r][c].type !== TileType.WEEDS) continue;
            const i = r * COLS + c;
            if (tileMeshes[i])       { scene.remove(tileMeshes[i]);       tileMeshes[i]       = null; }
            if (vegFoliageMeshes[i]) { scene.remove(vegFoliageMeshes[i]); setVegFoliageMesh(i, null); }
            _buildOneTileMesh(c, r);
          }
        _rebuildFarmBillboards();
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

      // Indices of tiles that currently have a crop — rebuilt lazily whenever
      // a tile changes so updateCropMeshes() doesn't scan all 936 tiles.
      let _cropTileIndices = null;
      function _invalidateCropList() { _cropTileIndices = null; }
      function _ensureCropList() {
        if (_cropTileIndices !== null) return;
        _cropTileIndices = [];
        for (let row = 0; row < ROWS; row++)
          for (let col = 0; col < COLS; col++)
            if (grid[row][col].crop) _cropTileIndices.push(row * COLS + col);
      }

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
        _ensureCropList();
        const _now = performance.now();
        for (const i of _cropTileIndices) {
          const col  = i % COLS;
          const row  = (i / COLS) | 0;
          const tile = grid[row][col];

          // Stale entry (crop was harvested since last list rebuild) — clean up.
          if (!tile.crop) {
            if (cropMeshes[i]) { scene.remove(cropMeshes[i]); cropMeshes[i] = null; }
            cropGrowthBucket[i] = -1;
            _invalidateCropList();
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

              const bobY = tile.cropReady ? Math.sin(_now / 500 + col + row) * 0.025 : 0;
              mesh.position.set(col + 0.5, surfY + 0.01 + bobY, row + 0.5);
              if (tile.cropReady) mesh.rotation.y = _now / 2200 + col;

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
              const bobY = tile.cropReady ? Math.sin(_now / 500 + col + row) * 0.03 : 0;
              mesh.position.set(col + 0.5, surfY + size / 2 + 0.02 + bobY, row + 0.5);
              if (tile.cropReady) mesh.rotation.y = _now / 1200 + col;
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
          _markTerrainEdgeId(floorMesh, TileType.GRASS);
          // Plateau mound: stone for elevated/cliff cells, grass for ground-level base
          const { stoneGeo, grassGeo } = buildRockTileGeo(col, row);
          let moundRoot = null;
          if (stoneGeo) {
            const m = new THREE.Mesh(stoneGeo, tileMats.rock);
            m.castShadow = m.receiveShadow = true;
            m.position.set(col + 0.5, NORMAL_TOP, row + 0.5);
            scene.add(m);
            _markTerrainEdgeId(m, TileType.ROCK);
            moundRoot = m;
          }
          if (grassGeo) {
            const m = new THREE.Mesh(grassGeo, tileMats.grass);
            m.castShadow = m.receiveShadow = true;
            m.position.set(col + 0.5, NORMAL_TOP, row + 0.5);
            scene.add(m);
            _markTerrainEdgeId(m, TileType.GRASS);
            if (!moundRoot) moundRoot = m;
          }
          if (moundRoot) moundRoot._windAmp = 0;  // wind loop skips _windAmp=0
          setVegFoliageMesh(i, moundRoot || { _windAmp: 0 });
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
          _markTerrainEdgeId(floorMesh, TileType.GRASS);

          const vegGroup = window.FoliageGenerator.buildShrubMesh(col, row);
          vegGroup._windPhase = (col * 1.7 + row * 2.3) % (Math.PI * 2);
          vegGroup._windAmp   = 0.06;
          vegGroup.scale.set(2, 2, 2);
          vegGroup.position.set(col + 0.5, tileSurfaceY(tile.type), row + 0.5);
          scene.add(vegGroup);
          setVegFoliageMesh(i, vegGroup);
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
          _markTerrainEdgeId(floorMesh, TileType.GRASS);

          if (s_weed3D && window.FoliageGenerator) {
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
            setVegFoliageMesh(i, vegGroup);
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
            _markTerrainEdgeId(m, TileType.TRENCH);
            primary = m;
          }
          if (grassGeo) {
            const m = new THREE.Mesh(grassGeo, tileMats.grass);
            m.castShadow = m.receiveShadow = true;
            m.position.set(col + 0.5, NORMAL_TOP, row + 0.5);
            m._windAmp = 0;
            scene.add(m);
            m.layers.enable(1);  // material transition outline
            _markTerrainEdgeId(m, TileType.GRASS);
            setVegFoliageMesh(i, m);
            if (!primary) primary = m;
          }
          tileMeshes[i] = primary;
          return;
        }

        if (tile.type === TileType.PATH) {
          const { pathGeo, grassGeo } = buildPathTileGeo(col, row);
          let primary = null;
          if (pathGeo) {
            const m = new THREE.Mesh(pathGeo, tileMats.path);
            m.castShadow = m.receiveShadow = true;
            m.position.set(col + 0.5, NORMAL_TOP, row + 0.5);
            _markTerrainEdgeId(m, TileType.PATH);
            scene.add(m);
            primary = m;
          }
          if (grassGeo) {
            const m = new THREE.Mesh(grassGeo, tileMats.grass);
            m.castShadow = m.receiveShadow = true;
            m.position.set(col + 0.5, NORMAL_TOP, row + 0.5);
            scene.add(m);
            _markTerrainEdgeId(m, TileType.GRASS);
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
        } else {
          // Flat ground tiles (grass/tilled/paddy/river/stream bed) — fallback
          // foliage billboards above are skipped since they aren't flat ground.
          _markTerrainEdgeId(mesh, _terrainCategoryFor(tile.type));
        }
      }

      function buildTileMeshes() {
        for (let row = 0; row < ROWS; row++) {
          for (let col = 0; col < COLS; col++) {
            const i = row * COLS + col;
            if (tileMeshes[i])          { scene.remove(tileMeshes[i]);          tileMeshes[i]          = null; }
            if (waterMeshes[i])         { scene.remove(waterMeshes[i]);         setWaterMesh(i, null); }
            if (cropMeshes[i])          { scene.remove(cropMeshes[i]);          cropMeshes[i]          = null; }
            if (vegFoliageMeshes[i])    { scene.remove(vegFoliageMeshes[i]);    setVegFoliageMesh(i, null); }
            cropGrowthBucket[i] = -1;
            _buildOneTileMesh(col, row);
          }
        }
        _rebuildFarmBillboards();
      }

      // Update a single tile mesh (called after shovel actions)
      function refreshTileMesh(col, row) {
        const i = row * COLS + col;
        if (tileMeshes[i])          { scene.remove(tileMeshes[i]);          tileMeshes[i]          = null; }
        if (waterMeshes[i])         { scene.remove(waterMeshes[i]);         setWaterMesh(i, null); }
        if (cropMeshes[i])          { scene.remove(cropMeshes[i]);          cropMeshes[i]          = null; }
        if (vegFoliageMeshes[i])    { scene.remove(vegFoliageMeshes[i]);    setVegFoliageMesh(i, null); }
        cropGrowthBucket[i] = -1;
        _buildOneTileMesh(col, row);
        _rebuildFarmBillboards();
      }

      // ── Update water meshes each frame ─────────────────────────────
      function updateWaterMeshes() {
        waterTime += 0.016; // ~60fps accumulation; matches visual speed regardless of frame rate

        if (_waterSimDirty) {
          // Full refresh: recompute flow direction, colour, depth, position.
          // Runs only after recomputeWater() (~every 9 real seconds).
          _waterSimDirty = false;
          _flowingTrenchTiles = [];
          for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < COLS; col++) {
              const i    = row * COLS + col;
              const tile = grid[row][col];

              if (isSolid(tile.type) || tile.water < 0.003) {
                if (waterMeshes[i]) { scene.remove(waterMeshes[i]); setWaterMesh(i, null); }
                tile._wCached = false;
                continue;
              }

              if (tile.type === TileType.TRENCH && tile.flow) _flowingTrenchTiles.push({ col, row });

              const depthFrac = tile.water / MAX_WATER;
              const surfaceA  = tileSurfaceY(tile.type) + tile.water * WATER_UNIT;

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
              const r = clamp(180 - depthFrac * 160, 20, 180) / 255;
              const g = clamp(220 - depthFrac * 100, 100, 220) / 255;

              tile._wCached   = true;
              tile._wSurfA    = surfaceA;
              tile._wDepth    = depthFrac;
              tile._wFlowNX   = flowNX;
              tile._wFlowNZ   = flowNZ;
              tile._wR        = r;
              tile._wG        = g;

              if (!waterMeshes[i]) {
                const wm = new THREE.Mesh(waterGeo, makeWaterMaterial(col, row));
                wm.receiveShadow = false;
                scene.add(wm);
                // Only tag dedicated water-holding features (trench/paddy) for the
                // material-edge outline — rain wets every non-solid tile, and tagging
                // that incidental puddle film too would seam-outline the entire tile
                // grid the moment it starts raining.
                if (tile.type === TileType.TRENCH || tile.type === TileType.PADDY) _markTerrainEdgeId(wm, 'water');
                setWaterMesh(i, wm);
              }
              const wm = waterMeshes[i];
              wm.position.set(col + 0.5, surfaceA + 0.015, row + 0.5);
              const u = wm.material.uniforms;
              u.uTime.value  = waterTime;
              u.uDepth.value = depthFrac;
              u.uFlow.value.set(flowNX, flowNZ);
              u.uColor.value.setRGB(r, g, 1.0);
            }
          }
        } else {
          // Fast path: only push updated time uniform — all other values are stable
          // between sim ticks so no recomputation is needed.
          for (const i of _waterActive) {
            waterMeshes[i].material.uniforms.uTime.value = waterTime;
          }
        }
      }

      // Same as updateWaterMeshes() but for the town's ditch (TRENCH) tiles,
      // so town weather can fill them with water exactly like farm trenches.
      function updateTownWaterMeshes() {
        waterTime += 0.016;
        for (const wm of _townRiverWaterMeshes) wm.material.uniforms.uTime.value = waterTime;
        const TCOLS = _townZone?.cols || 60, TROWS = _townZone?.rows || 50;

        if (_townWaterSimDirty) {
          _townWaterSimDirty = false;
          _townFlowingTrenchTiles = [];
          for (let row = 0; row < TROWS; row++) {
            for (let col = 0; col < TCOLS; col++) {
              const key  = col + ',' + row;
              const tile = townGrid[row][col];

              // Town rivers/streams already have their own static water-surface
              // mesh (_townRiverWaterMeshes, built in buildTownScene) — skip them
              // here so this irrigation-style dynamic mesh doesn't double up.
              if (isSolid(tile.type) || tile.water < 0.003 ||
                  tile.type === TileType.RIVER || tile.type === TileType.STREAM) {
                const old = townWaterMeshes.get(key);
                if (old) { townScene.remove(old); townWaterMeshes.delete(key); }
                continue;
              }

              if (tile.type === TileType.TRENCH && tile.flow) _townFlowingTrenchTiles.push({ col, row });

              const depthFrac = tile.water / MAX_WATER;
              const surfaceA  = tileSurfaceY(tile.type) + tile.water * WATER_UNIT;

              let fx = 0, fz = 0;
              const nbrs = [
                { dc:  0, dr:  1, ax: 0, az:  1 },
                { dc:  0, dr: -1, ax: 0, az: -1 },
                { dc:  1, dr:  0, ax: 1, az:  0 },
                { dc: -1, dr:  0, ax: -1,az:  0 },
              ];
              for (const { dc, dr, ax, az } of nbrs) {
                const nc = col + dc, nr = row + dr;
                if (nc < 0 || nc >= TCOLS || nr < 0 || nr >= TROWS) continue;
                const nt = townGrid[nr][nc];
                if (isSolid(nt.type)) continue;
                const surfB = tileSurfaceY(nt.type) + nt.water * WATER_UNIT;
                const head  = surfaceA - surfB;
                if (head > 0.01) { fx += ax * head; fz += az * head; }
              }
              const flowLen = Math.hypot(fx, fz);
              const flowNX  = flowLen > 0.001 ? fx / flowLen : 0;
              const flowNZ  = flowLen > 0.001 ? fz / flowLen : 0;
              const r = clamp(180 - depthFrac * 160, 20, 180) / 255;
              const g = clamp(220 - depthFrac * 100, 100, 220) / 255;

              let wm = townWaterMeshes.get(key);
              if (!wm) {
                wm = new THREE.Mesh(waterGeo, makeWaterMaterial(col, row));
                wm.receiveShadow = false;
                townScene.add(wm);
                // See farm updateWaterMeshes() — only outline dedicated water-holding
                // ditches, not every tile's incidental rain puddle.
                if (tile.type === TileType.TRENCH || tile.type === TileType.PADDY) _markTerrainEdgeId(wm, 'water');
                townWaterMeshes.set(key, wm);
              }
              wm.position.set(col + 0.5, surfaceA + 0.015, row + 0.5);
              const u = wm.material.uniforms;
              u.uTime.value  = waterTime;
              u.uDepth.value = depthFrac;
              u.uFlow.value.set(flowNX, flowNZ);
              u.uColor.value.setRGB(r, g, 1.0);
            }
          }
        } else {
          for (const wm of townWaterMeshes.values()) {
            wm.material.uniforms.uTime.value = waterTime;
          }
        }
      }

      // Animates a zone's waterfall curtain mesh(es) (see
      // buildWaterfallCurtainMeshes) — there's no per-tile dynamic water sim
      // here like updateTownWaterMeshes/updateWaterMeshes, just the uTime
      // uniform driving the shader's scroll/ripple, so this is a thin loop.
      function updateZoneWaterMeshes(mapId) {
        waterTime += 0.016;
        const meshes = _zoneWaterMeshes.get(mapId);
        if (!meshes) return;
        for (const wm of meshes) wm.material.uniforms.uTime.value = waterTime;
      }

      // ── Update player cube ────────────────────────────────────────
      function updatePlayerMesh(dt) {
        // Convert 2D grid coords to 3D world coords
        const wx = player.x / TILE;  // world X (col)
        const wz = player.y / TILE;  // world Z (row)
        const col = clamp(Math.floor(wx), 0, getActiveCols()-1);
        const row = clamp(Math.floor(wz), 0, getActiveRows()-1);
        const tile = getActiveTileAt(col, row);
        // While climbing, the player is mid-crossing through impassable
        // incline tiles — use the scripted start->landing blend from
        // updateClimb instead of a raw tile lookup, which would pop between
        // the cliff base and plateau top the instant the crossing tile
        // flips (see startClimb/updateClimb).
        const standY = player.climbing ? player.climbSurfaceY : tileSurfaceYInArea(tile, currentArea);

        // Smooth vertical position (bob over water, plus a combat lunge's
        // cosmetic leap arc — see beginCombatLunge/player.lungeHopCurrent —
        // or a climbing hop's bounce, see player.climbHopBounce)
        const targetY = standY + (tile.water > 0.05 ? tile.water * WATER_UNIT * 0.6 : 0) + (player.lungeHopCurrent || 0) + (player.climbHopBounce || 0);
        playerMesh.position.x += (wx - playerMesh.position.x) * 0.25;
        playerMesh.position.z += (wz - playerMesh.position.z) * 0.25;
        playerMesh.position.y += (targetY - playerMesh.position.y) * 0.18;
        playerGroundShadow.position.set(playerMesh.position.x, standY + characterGroundShadowSurfaceOffset(), playerMesh.position.z);

        // Rotate to face movement direction with perp clamp (dead zone ±15° from east/west).
        if (!player.perpState) player.perpState = {};
        const rawTargetRotY = -facingAngle + Math.PI / 2;
        const { effectiveTarget: pEffTarget, snapTo: pSnapTo } = perpClamp(player.perpState, rawTargetRotY, cameraRelativePerps());
        if (pSnapTo !== null) playerFacing = pEffTarget;
        else playerFacing += angleDiff(pEffTarget, playerFacing) * 0.18;
        playerMesh.rotation.y = playerFacing;  // default; sweep branch in updateToolMesh may override

        // Bob animation when moving
        const speed = Math.hypot(player.vx, player.vy);
        if (speed > 5) {
          playerMesh.position.y += Math.sin(performance.now() / 120) * 0.03;
        }
      }

      // ── Update reticle ────────────────────────────────────────────
      function updateReticleMesh() {
        const reticle = getReticleTile();
        const tile    = getActiveGrid()[reticle.row]?.[reticle.col];
        if (!tile) {
          reticleCircleMesh.visible = false;
          reticleRingMesh.visible   = false;
          reticleWavyGroup.visible  = false;
          clearTargetHighlights();
          return;
        }
        const surfY   = tileSurfaceYInArea(tile, currentArea) + 0.01
                      + (tile.water > 0.02 ? tile.water * WATER_UNIT + 0.04 : 0);
        const allowed = canUseAction(activeTool, activeAction, reticle.col, reticle.row);
        const t       = performance.now();
        const pulse   = 1 + 0.06 * Math.sin(t / 300);

        const onFarm     = currentArea === 'farm';
        const weaponEquipped = activeTool === 'weapon';
        const isExcavate = onFarm && !weaponEquipped && allowed && (activeAction === 'dig' || activeAction === 'raise');
        const isHoeWork  = onFarm && !weaponEquipped && allowed && activeTool === 'hoe';
        const showTile   = isExcavate || isHoeWork;
        const isObjTarget = onFarm && allowed && !showTile && !weaponEquipped;
        const i = reticle.row * COLS + reticle.col;
        const cuttableTarget = onFarm && weaponEquipped && (tile.type === TileType.WEEDS || tile.type === TileType.SHRUB || !!vegFoliageMeshes[i]);
        const isWeedBlock = onFarm && !allowed && activeTool === 'hoe' && activeAction === 'till'
                         && (tile.type === TileType.WEEDS || !!vegFoliageMeshes[i]);

        // Base tile box
        reticleMesh.visible = !weaponEquipped;
        reticleMesh.position.set(reticle.col + 0.5, surfY, reticle.row + 0.5);
        reticleMesh.material = showTile ? reticleIntenseMat
                             : (allowed ? reticleMat : reticleBlockedMat);
        reticleMesh.scale.set(pulse, 1, pulse);

        // Floor circle — dig / raise only
        if (isExcavate) {
          reticleCircleMesh.visible = true;
          reticleCircleMesh.position.set(reticle.col + 0.5, surfY + 0.02, reticle.row + 0.5);
          const cp = 1 + 0.09 * Math.sin(t / 250);
          reticleCircleMesh.scale.set(cp, cp, cp);
        } else {
          reticleCircleMesh.visible = false;
        }

        // Wavy lines — hoe only
        if (isHoeWork) {
          reticleWavyGroup.visible = true;
          reticleWavyGroup.position.set(reticle.col + 0.5, surfY + 0.02, reticle.row + 0.5);
          const wp = 1 + 0.08 * Math.sin(t / 270);
          reticleWavyGroup.scale.set(wp, wp, wp);
        } else {
          reticleWavyGroup.visible = false;
        }

        // Object outline (layer 2) and fallback ring
        clearTargetHighlights();
        if (isObjTarget || isWeedBlock || cuttableTarget) {
          const meshes = cuttableTarget && tile.type === TileType.WEEDS && !s_weed3D ? [] : findTargetMeshes(reticle.col, reticle.row);
          if (meshes.length > 0) {
            for (const m of meshes) m.layers.enable(2);
            _targetOutlineMeshes = meshes;
            _targetOutlineAllowed = isObjTarget;
            updateCuttableBillboardGlow(0, 0, false);
            reticleRingMesh.visible = false;
          } else if (cuttableTarget && tile.type === TileType.WEEDS && !s_weed3D) {
            updateCuttableBillboardGlow(reticle.col, reticle.row, true);
            reticleRingMesh.visible = false;
          } else {
            // No specific mesh — fall back to floating ring
            const worldObj = getWorldObjectAt(reticle.col, reticle.row);
            const ringH    = worldObj ? 0.95 : (tile.crop ? 0.65 : 0.45);
            const bob      = 0.06 * Math.sin(t / 600);
            reticleRingMesh.visible = true;
            reticleRingMesh.position.set(reticle.col + 0.5, surfY + ringH + bob, reticle.row + 0.5);
            reticleRingMesh.rotation.y = t / 2500;
            const rp = 0.92 + 0.08 * Math.sin(t / 500);
            reticleRingMesh.scale.set(rp, rp, rp);
          }
        } else {
          reticleRingMesh.visible = false;
        }
      }

      // ── Update lighting from time-of-day ──────────────────────────
      let _lastLightUpdateTime = 0;
      function updateThreeLighting() {
        // Lighting changes on a 72-second game day — pushing uniforms every
        // frame wastes ~1 ms. Throttle to every 500 ms; imperceptible.
        const now = performance.now();
        if (now - _lastLightUpdateTime < 500) return;
        _lastLightUpdateTime = now;
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
        // Grass billboards are an unlit shader, not MeshLambertMaterial — drive their
        // tint/brightness from the same values as ambientLight so blades match the
        // ground's day/night response instead of staying a fixed brightness.
        if (grassBillboardMat) {
          grassBillboardMat.uniforms.uLightColor.value.setRGB(r/255 * 0.6 + 0.4, g/255 * 0.6 + 0.4, b/255 * 0.6 + 0.4);
          grassBillboardMat.uniforms.uLightMul.value = 0.3 + brightnessMul * 0.7;
        }
        // Fog colour matches sky
        scene.background.setRGB(
          Math.max(0, r/255 * 0.15 + 0.04),
          Math.max(0, g/255 * 0.15 + 0.08),
          Math.max(0, b/255 * 0.15 + 0.06)
        );
        scene.fog.color.copy(scene.background);
      }

      let _lastTownLightUpdateTime = 0;
      function updateTownThreeLighting() {
        const now = performance.now();
        if (now - _lastTownLightUpdateTime < 500) return;
        _lastTownLightUpdateTime = now;
        const { r, g, b, a } = getLightingState();
        const brightnessMul = 1 - a * 0.7;
        townAmbientLight.intensity = 0.3 + brightnessMul * 0.7;
        townAmbientLight.color.setRGB(
          (r/255) * 0.6 + 0.4,
          (g/255) * 0.6 + 0.4,
          (b/255) * 0.6 + 0.4
        );
        townSunLight.intensity = brightnessMul * 1.2;
        townSunLight.color.setRGB(r/255 * 0.5 + 0.5, g/255 * 0.5 + 0.5, b/255 * 0.4 + 0.6);
        if (grassBillboardMat) {
          grassBillboardMat.uniforms.uLightColor.value.setRGB(r/255 * 0.6 + 0.4, g/255 * 0.6 + 0.4, b/255 * 0.6 + 0.4);
          grassBillboardMat.uniforms.uLightMul.value = 0.3 + brightnessMul * 0.7;
        }
        townScene.background.setRGB(
          Math.max(0, r/255 * 0.15 + 0.04),
          Math.max(0, g/255 * 0.15 + 0.08),
          Math.max(0, b/255 * 0.15 + 0.06)
        );
        townScene.fog.color.copy(townScene.background);
      }

      // ── Cached container rect — avoids repeated layout reflows per frame ─
      // Updated in resizeCanvas(); used by drawing functions and worldToOverlay.
      let _threeRect = { width: window.innerWidth, height: window.innerHeight };

      // ── Resize handler ────────────────────────────────────────────
      function resizeCanvas() {
        const dpr  = Math.min(window.devicePixelRatio, 2);
        const rect = threeContainer.getBoundingClientRect();
        _threeRect = rect;
        const w = rect.width  || window.innerWidth;
        const h = rect.height || window.innerHeight;
        renderer.setPixelRatio(dpr * s_resScale);
        renderer.setSize(w, h);
        const bufSize = renderer.getDrawingBufferSize(new THREE.Vector2());
        _resizeOutlineTargets(bufSize.x, bufSize.y);
        overlayCanvas.width  = Math.round(w * dpr);
        overlayCanvas.height = Math.round(h * dpr);
        octx.setTransform(dpr, 0, 0, dpr, 0, 0);
        lightingCanvas.width  = Math.round(w * dpr);
        lightingCanvas.height = Math.round(h * dpr);
        lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      // ── Visual feature toggles (Settings tab) ────────────────────
      let s_outlines  = true;
      let s_depthOutlines = false;       // extra depth-seam outline pass — off by default (heavier)
      let s_depthOutlineThreshScale = 1; // sensitivity: lower = catches smaller depth gaps
      let s_grass     = true;
      let s_weed3D    = false;  // false = Mode A (oversized billboards), true = Mode B (3D foliage)
      let s_billWind  = true;
      let s_fpsCounter = false;
      let s_resScale   = 1;  // render-resolution scale applied to the 3D renderer's pixel ratio
      // Debug hitbox overlay — unlike the other visual toggles above, its
      // state is cached across sessions (it's a dev tool you flip on once
      // and want to stay on, not a per-session visual preference).
      const HITBOX_DEBUG_STORAGE_KEY = 'hobunjiDebugHitboxes';
      let s_showHitboxes = false;
      try { s_showHitboxes = localStorage.getItem(HITBOX_DEBUG_STORAGE_KEY) === '1'; } catch {}

      const fpsCounterEl = document.getElementById('fpsCounter');
      let _fpsFrames = 0, _fpsAccum = 0;

      buildTileMeshes();
      buildBorderTerrain();

      // ── Settings tab checkbox wiring ──────────────────────────────
      document.getElementById('settingOutlines').addEventListener('change', e => {
        s_outlines = e.target.checked;
      });
      document.getElementById('settingDepthOutlines').addEventListener('change', e => {
        s_depthOutlines = e.target.checked;
      });
      document.getElementById('settingDepthOutlineSensitivity').addEventListener('input', e => {
        // Slider is "sensitivity" (higher = catches smaller depth gaps), so
        // invert it into the threshold-scale multiplier used by the shader.
        const sensitivity = Number(e.target.value);
        s_depthOutlineThreshScale = 2.0 + (0.25 - 2.0) * sensitivity;
      });
      document.getElementById('settingGrass').addEventListener('change', e => {
        s_grass = e.target.checked;
        if (farmGrassBillMesh) farmGrassBillMesh.visible = s_grass;
        if (townGrassBillMesh) townGrassBillMesh.visible = s_grass;
        if (townBorderGrassBillMesh) townBorderGrassBillMesh.visible = s_grass;
      });
      document.getElementById('settingBillWind').addEventListener('change', e => {
        s_billWind = e.target.checked;
      });
      document.getElementById('settingWeed3D').addEventListener('change', e => {
        s_weed3D = e.target.checked;
        _rebuildWeedTiles();
      });
      document.getElementById('settingFpsCounter').addEventListener('change', e => {
        s_fpsCounter = e.target.checked;
        fpsCounterEl.style.display = s_fpsCounter ? '' : 'none';
        _fpsFrames = 0; _fpsAccum = 0;
      });
      document.getElementById('settingResolution').addEventListener('change', e => {
        s_resScale = parseFloat(e.target.value) || 1;
        resizeCanvas();
      });
      const settingShowHitboxesEl = document.getElementById('settingShowHitboxes');
      settingShowHitboxesEl.checked = s_showHitboxes;
      settingShowHitboxesEl.addEventListener('change', e => {
        s_showHitboxes = e.target.checked;
        try { localStorage.setItem(HITBOX_DEBUG_STORAGE_KEY, s_showHitboxes ? '1' : '0'); } catch {}
      });
      function setCameraZoomScale(value) {
        const cfg = desktopControlsConfig();
        const min = Number.isFinite(Number(cfg.wheelZoomMin)) ? Number(cfg.wheelZoomMin) : 0.75;
        const max = Number.isFinite(Number(cfg.wheelZoomMax)) ? Number(cfg.wheelZoomMax) : 2.5;
        s_zoomScale = clamp(Number(value) || 1.5, min, max);
        const zoomSetting = document.getElementById('settingZoom');
        if (zoomSetting) zoomSetting.value = String(s_zoomScale);
        updateCameraPosition();
      }
      document.getElementById('settingZoom').addEventListener('change', e => {
        setCameraZoomScale(parseFloat(e.target.value) || 1.5);
      });

      function gameLoop(now) {
        const dt = Math.min(0.04, (now - lastTime) / 1000);
        lastTime = now;

        if (s_fpsCounter) {
          _fpsFrames++;
          _fpsAccum += dt;
          if (_fpsAccum >= 0.5) {
            fpsCounterEl.textContent = Math.round(_fpsFrames / _fpsAccum) + ' FPS';
            _fpsFrames = 0;
            _fpsAccum  = 0;
          }
        }

        if (!gameStarted) {
          audioDebug('waiting for gameStarted before audio playback', 'audio-wait-game-started', 5000);
          renderer.render(scene, camera);
          requestAnimationFrame(gameLoop);
          return;
        }

        updateSceneTransition(dt);

        if (fishingMinigame?.active) updateFishingMinigame(dt);

        updateRainAudio();
        updateExteriorBgs();
        updateFurnitureSfxSources();
        updateAmbientCues();
        audioDebug('audio tick active area=' + currentArea + ' paused=' + paused + ' gameStarted=' + gameStarted, 'audio-tick-' + currentArea, 5000);

        if (!paused) {
          updateCalendar(dt);
          _advanceSmoothedLighting(dt);
          pollControllerInput();
          updateMovement(dt);
          updatePlayerVitals(dt);

          if (currentArea === 'farm' || currentArea === 'town' || _isZoneArea(currentArea)) {
            syncCompanionFromWhistle();
            updateCompanions(dt);
            updateHostileSpawning(dt);
            updateHostiles(dt);
            updateCorpses(dt);
          }

          // Interior exit detection: player walks south through exit door
          if (currentArea === 'interior' && sceneTransDir === 0) {
            const iyTile = player.y / TILE;
            const ixTile = player.x / TILE;
            if (iyTile > INTERIOR_EXIT_ROW + 0.4 && ixTile > INTERIOR_EXIT_COL - 0.2 && ixTile < INTERIOR_EXIT_COL + 2.2) {
              exitInterior();
            }
          }

          // Transition spots (farm ↔ interior ↔ town ↔ building)
          if (sceneTransDir === 0) checkTransitionSpots();

          if (currentArea === 'farm' || currentArea === 'town') {
            waterFlowPhase = (waterFlowPhase + dt * 3.2) % 1;
            updateWaterParticles(dt);
            updateRipples(dt);
            updateLightningFlash(dt);
          }
          updateActionParticles(dt);
          // Water sim ticks every 1/8 game-hour (~9s real-time)
          // Uses game time so rain and drainage are clock-consistent
          simAccumulator += dt / DAY_LENGTH_SECONDS * (NIGHT_HOUR - MORNING_HOUR); // game-hours per sec
          if (simAccumulator >= 0.125 && (currentArea === 'farm' || currentArea === 'town')) {
            simAccumulator -= 0.125;
            if (currentArea === 'farm') {
              recomputeWater(false);
              tickWorldObjects();
            } else {
              const TCOLS = _townZone?.cols || 60, TROWS = _townZone?.rows || 50;
              recomputeWater(false, townGrid, TROWS, TCOLS);
            }
            spawnRipples();
          }
        }

        // ── Camera smooth follow ─────────────────────────────────
        const targetPosition = activeCameraTarget?.position;
        const wx = targetPosition ? targetPosition.x : player.x / TILE;
        const wz = targetPosition ? targetPosition.z : player.y / TILE;
        const wy = targetPosition ? targetPosition.y : _playerGroundY();
        const camLerp = cameraModeConfig(activeCameraMode).followLerp ?? 0.08;
        camTargetX += (wx - camTargetX) * camLerp;
        camTargetZ += (wz - camTargetZ) * camLerp;
        camTargetY += (wy - camTargetY) * camLerp;
        updateCameraPosition();

        // ── Three.js updates ─────────────────────────────────────
        updatePlayerMesh(dt);
        if (!paused) {
          updateNpcWalkers(dt);
          if (dialogueOpen) faceNpcDialogueParticipants();
        }
        if (currentArea === 'town') {
          updateTownWaterMeshes();
          updateTownThreeLighting();
        }
        if (_isZoneArea(currentArea)) {
          updateZoneWaterMeshes(currentArea);
        }
        // The player can wield tools/weapons outside the farm too (town,
        // exterior zones) — buildings/farmhouse interior intentionally
        // exclude toolHolder/reticle meshes from their scene graph instead.
        if (currentArea === 'farm' || currentArea === 'town' || _isZoneArea(currentArea)) {
          updateToolMesh(dt);
          updateChargeAction();
          window.Combat?.update(dt);
          updateReticleMesh();
        }
        if (currentArea === 'farm') {
          updateWaterMeshes();
          updateCropMeshes();
          updateAnimalMeshes(dt);
          updateThreeLighting();

          // Wind animation on vegetation
          const windTime = performance.now() / 1000;
          const windStrBase = calendar.isRaining
            ? (calendar.rainStrength >= 3 ? 0.10 : 0.06)
            : 0.03;
          const _playerTX = player.x / TILE;
          const _playerTZ = player.y / TILE;
          for (const vm of vegMeshes) {
            if (vm.material && vm.material.uniforms) {
              vm.material.uniforms.uTime.value = windTime;
              // Proximity boost only triggers within 1.2 tiles. Use cheap
              // Manhattan pre-check to skip Math.hypot for distant meshes.
              const adx = Math.abs(vm.position.x - _playerTX);
              const adz = Math.abs(vm.position.z - _playerTZ);
              let proximityStr;
              if (adx < 1.4 && adz < 1.4) {
                const dist = Math.hypot(adx, adz);
                proximityStr = dist < 1.2 ? windStrBase + 0.12 * (1.2 - dist) / 1.2 : windStrBase;
              } else {
                proximityStr = windStrBase;
              }
              vm.material.uniforms.uStrength.value += (proximityStr - vm.material.uniforms.uStrength.value) * 0.15;
            }
          }
          const windScale = windStrBase / 0.03;
          for (const _vfi of _vegFoliageActive) {
            const fg = vegFoliageMeshes[_vfi];
            if (!fg || !fg._windAmp) continue;
            // Skip foliage well outside the camera view — it won't be visible.
            if (Math.abs(fg.position.x - _playerTX) > 14 || Math.abs(fg.position.z - _playerTZ) > 11) continue;
            const amp = fg._windAmp * windScale;
            fg.rotation.z = amp * Math.sin(windTime * 1.6 + fg._windPhase);
            fg.rotation.x = amp * 0.45 * Math.cos(windTime * 1.1 + fg._windPhase * 1.3);
          }
          if (grassBillboardMat) {
            grassBillboardMat.uniforms.uTime.value     = windTime;
            grassBillboardMat.uniforms.uStrength.value = s_billWind ? windStrBase : 0;
          }
        }
        if (currentArea === 'town' && grassBillboardMat) {
          // Town grass billboards share the farm's wind shader/material, so keep
          // them swaying too — farm's block above only runs while on the farm.
          const windTime = performance.now() / 1000;
          grassBillboardMat.uniforms.uTime.value     = windTime;
          grassBillboardMat.uniforms.uStrength.value = s_billWind ? (calendar.isRaining ? (calendar.rainStrength >= 3 ? 0.10 : 0.06) : 0.03) : 0;
        }

        // ── Render active scene ──────────────────────────────────
        const activeScene = getActiveScene();
        if (s_outlines) {
          // Colour + depth into an offscreen target so the post-process
          // composite below can read real per-pixel depth afterwards —
          // rendering straight to the canvas would lose that depth buffer
          // the moment the fullscreen composite quad overwrites it.
          renderer.setRenderTarget(_mainRT);
          renderer.render(activeScene, camera);

          // Selective shell outline pass (layer-1 objects only)
          renderer.autoClearColor = false;
          renderer.autoClearDepth = false;
          activeScene.overrideMaterial = shellOutlineMat;
          camera.layers.set(1);
          renderer.render(activeScene, camera);
          camera.layers.enableAll();
          activeScene.overrideMaterial = null;

          // Coloured target outline pass (layer-2 objects — green allowed, red blocked)
          if (_targetOutlineMeshes.length > 0) {
            scene.overrideMaterial = _targetOutlineAllowed ? targetOutlineGreenMat : targetOutlineRedMat;
            camera.layers.set(2);
            renderer.render(scene, camera);
            camera.layers.enableAll();
            scene.overrideMaterial = null;
          }
          renderer.autoClearColor = true;
          renderer.autoClearDepth = true;

          // Furniture material-ID buffer (layer-3 objects only) — feeds the
          // material-seam edge detection in the composite shader below.
          renderer.setRenderTarget(_edgeIdRT);
          renderer.setClearColor(0x000000, 0);
          renderer.clear(true, true, false);
          camera.layers.set(3);
          activeScene.overrideMaterial = _furnitureIdMat;
          renderer.render(activeScene, camera);
          activeScene.overrideMaterial = null;
          camera.layers.enableAll();

          // Depth-only source for the depth-edge detector, PNG-plane avatars
          // hidden for this pass only (see _markPngPlane) so sprite cutout
          // silhouettes never feed the detector. Opt-in/off by default since
          // it's an extra full scene pass on top of everything above.
          if (s_depthOutlines) {
            const _hiddenPngPlanes = [];
            activeScene.traverse(o => {
              if (o.userData.isPngPlane && o.visible) { o.visible = false; _hiddenPngPlanes.push(o); }
            });
            renderer.setRenderTarget(_depthOnlyRT);
            activeScene.overrideMaterial = _depthOnlyMat;
            renderer.render(activeScene, camera);
            activeScene.overrideMaterial = null;
            _hiddenPngPlanes.forEach(o => { o.visible = true; });
          }

          // Composite: blend depth-discontinuity + furniture material-seam
          // outlines over the rendered scene, straight to the canvas.
          renderer.setRenderTarget(null);
          _postMat.uniforms.tColor.value          = _mainRT.texture;
          _postMat.uniforms.tDepth.value           = s_depthOutlines ? _depthOnlyRT.depthTexture : _mainRT.depthTexture;
          _postMat.uniforms.tEdgeId.value          = _edgeIdRT.texture;
          _postMat.uniforms.tEdgeIdDepth.value     = _edgeIdRT.depthTexture;
          _postMat.uniforms.tSceneDepth.value      = _mainRT.depthTexture;
          _postMat.uniforms.uCameraNear.value      = camera.near;
          _postMat.uniforms.uCameraFar.value       = camera.far;
          _postMat.uniforms.uDepthOutlinesOn.value = s_depthOutlines ? 1 : 0;
          _postMat.uniforms.uDepthThreshScale.value = s_depthOutlineThreshScale;
          renderer.render(_postScene, _postCamera);
        } else {
          renderer.setRenderTarget(null);
          renderer.render(activeScene, camera);
          // Coloured target outline pass (layer-2 objects — green allowed, red blocked)
          if (_targetOutlineMeshes.length > 0) {
            renderer.autoClearColor = false;
            renderer.autoClearDepth = false;
            scene.overrideMaterial = _targetOutlineAllowed ? targetOutlineGreenMat : targetOutlineRedMat;
            camera.layers.set(2);
            renderer.render(scene, camera);
            camera.layers.enableAll();
            scene.overrideMaterial = null;
            renderer.autoClearColor = true;
            renderer.autoClearDepth = true;
          }
        }

        // ── 2D overlays (rain, lighting) ─────────────────────────
        drawOverlays();
        drawLightingOverlay();

        updateNpcDialoguePortrait(now);
        updateHud();
        requestAnimationFrame(gameLoop);
      }

      // ── Debug hitbox overlay (Settings → Dev Tools → Show Hitboxes) ─
      // Ground-plane circles for the player's and every creature's collision
      // footprint, plus whatever attack collider (if any) is currently live
      // on a creature: the Pounce leap's forward cone (the real cone passed
      // to deps.inCone, not a recomputed approximation) while it's in its
      // 'leap' stage, or the generic bite's range circle (that attack only
      // ever does a flat distance check, not a cone) while telegraphed.
      const DEBUG_HITBOX_COLOR_PLAYER    = '#5cf2ff';
      const DEBUG_HITBOX_COLOR_HOSTILE   = '#ff6a6a';
      const DEBUG_HITBOX_COLOR_COMPANION = '#7fe89a';
      const DEBUG_ATTACK_COLOR_WINDUP    = '#ffc23d';
      const DEBUG_ATTACK_COLOR_STRIKE    = '#ffffff';
      const DEBUG_ATTACK_COLOR_LEAP      = '#ff3df0';
      const DEBUG_AIM_COLLIDER_COLOR     = '#c792ff';
      // Deadzone arcs drawn per-creature when hitboxes are visible: the two
      // camera-relative dead zones where pngDeadzoneTarget lerps through rather
      // than tracking freely. The pngRot line shows where the PNG plane is
      // actually pointed right now (may differ from group rotation).
      const DEBUG_DEADZONE_FILL_COLOR    = '#cc2020';
      const DEBUG_DEADZONE_EDGE_COLOR    = '#ff5050';
      const DEBUG_PNG_ROT_COLOR          = '#ff80ff';
      // Player avatar's crossed-plane "prism" base width (tile units) —
      // mirrors the worldModelWidth lookup refreshPlayerAvatar() uses to
      // build the avatar mesh, since the player object stores no width
      // of its own.
      function playerModelWidthTiles() {
        return window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.worldModelWidth ?? 0.9;
      }

      function _debugGroundY(wx, wy) {
        const tile = getActiveTileAt(Math.floor(wx / TILE), Math.floor(wy / TILE));
        return (tile ? tileSurfaceY(tile.type) : 0) + 0.05;
      }

      function _drawDebugCircle(wx, wy, radiusPx, color, dashed) {
        const y = _debugGroundY(wx, wy);
        const center = worldToOverlay(wx / TILE, y, wy / TILE);
        if (!center.visible) return;
        const edge = worldToOverlay((wx + radiusPx) / TILE, y, wy / TILE);
        const r = Math.hypot(edge.x - center.x, edge.y - center.y);
        octx.save();
        octx.globalAlpha = 0.8;
        octx.strokeStyle = color;
        octx.lineWidth = 1.5;
        if (dashed) octx.setLineDash([5, 4]);
        octx.beginPath();
        octx.ellipse(center.x, center.y, r, r * 0.5, 0, 0, Math.PI * 2);
        octx.stroke();
        octx.restore();
      }

      function _drawDebugSquare(wx, wy, halfSizePx, color, dashed) {
        const y = _debugGroundY(wx, wy);
        const halfTiles = halfSizePx / TILE;
        const baseX = wx / TILE, baseZ = wy / TILE;
        const corners = [
          worldToOverlay(baseX - halfTiles, y, baseZ - halfTiles),
          worldToOverlay(baseX + halfTiles, y, baseZ - halfTiles),
          worldToOverlay(baseX + halfTiles, y, baseZ + halfTiles),
          worldToOverlay(baseX - halfTiles, y, baseZ + halfTiles),
        ];
        if (!corners[0].visible) return;
        octx.save();
        octx.globalAlpha = 0.8;
        octx.strokeStyle = color;
        octx.lineWidth = 1.5;
        if (dashed) octx.setLineDash([5, 4]);
        octx.beginPath();
        octx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i++) octx.lineTo(corners[i].x, corners[i].y);
        octx.closePath();
        octx.stroke();
        octx.restore();
      }

      function _drawDebugLine(wx1, wy1, wx2, wy2, color, dashed) {
        const p1 = worldToOverlay(wx1 / TILE, _debugGroundY(wx1, wy1), wy1 / TILE);
        const p2 = worldToOverlay(wx2 / TILE, _debugGroundY(wx2, wy2), wy2 / TILE);
        if (!p1.visible && !p2.visible) return;
        octx.save();
        octx.globalAlpha = 0.85;
        octx.strokeStyle = color;
        octx.lineWidth = 2;
        if (dashed) octx.setLineDash([4, 4]);
        octx.beginPath();
        octx.moveTo(p1.x, p1.y);
        octx.lineTo(p2.x, p2.y);
        octx.stroke();
        octx.restore();
      }

      function _drawDebugCone(wx, wy, angle, rangePx, halfConeRad, color) {
        const y = _debugGroundY(wx, wy);
        const rangeTiles = rangePx / TILE;
        const baseX = wx / TILE, baseZ = wy / TILE;
        const left = angle - halfConeRad, right = angle + halfConeRad;
        const origin = worldToOverlay(baseX, y, baseZ);
        if (!origin.visible) return;
        const leftEnd = worldToOverlay(baseX + Math.cos(left) * rangeTiles, y, baseZ + Math.sin(left) * rangeTiles);
        const rightEnd = worldToOverlay(baseX + Math.cos(right) * rangeTiles, y, baseZ + Math.sin(right) * rangeTiles);
        octx.save();
        octx.globalAlpha = 0.85;
        octx.strokeStyle = color;
        octx.lineWidth = 2;
        octx.beginPath();
        octx.moveTo(origin.x, origin.y);
        octx.lineTo(leftEnd.x, leftEnd.y);
        octx.lineTo(rightEnd.x, rightEnd.y);
        octx.closePath();
        octx.stroke();
        octx.restore();
      }

      // Ground-plane arc sector (for deadzone fans). fromAngle/toAngle are
      // world-space angles (same convention as c.facing / atan2 game coords).
      // radiusPx is the visual reach of the fan in game pixels.
      function _drawDebugArcSector(wx, wy, fromAngle, toAngle, radiusPx, edgeColor, fillColor) {
        const N = 20;
        const y = _debugGroundY(wx, wy);
        const bx = wx / TILE, bz = wy / TILE, rT = radiusPx / TILE;
        const origin = worldToOverlay(bx, y, bz);
        if (!origin.visible) return;
        const pts = [];
        for (let i = 0; i <= N; i++) {
          const a = fromAngle + (toAngle - fromAngle) * (i / N);
          pts.push(worldToOverlay(bx + Math.cos(a) * rT, y, bz + Math.sin(a) * rT));
        }
        octx.save();
        octx.beginPath();
        octx.moveTo(origin.x, origin.y);
        octx.lineTo(pts[0].x, pts[0].y);
        for (let i = 1; i <= N; i++) octx.lineTo(pts[i].x, pts[i].y);
        octx.closePath();
        octx.globalAlpha = 0.18;
        octx.fillStyle = fillColor;
        octx.fill();
        octx.globalAlpha = 0.75;
        octx.strokeStyle = edgeColor;
        octx.lineWidth = 1.5;
        octx.setLineDash([3, 3]);
        octx.stroke();
        octx.restore();
      }

      function _drawCreatureDebug(c, hitboxColor) {
        const def = c.def;
        const halfSize = creatureHitboxHalfSizePx(def);
        _drawDebugSquare(c.x, c.y, halfSize, hitboxColor, false);

        if (def.attacks?.includes('pounce')) {
          const ang = c.facing || 0;
          const reach = creatureAimColliderReachPx(def);
          const sx = c.x + Math.cos(ang) * halfSize, sy = c.y + Math.sin(ang) * halfSize;
          const ex = c.x + Math.cos(ang) * reach, ey = c.y + Math.sin(ang) * reach;
          _drawDebugLine(sx, sy, ex, ey, DEBUG_AIM_COLLIDER_COLOR, true);
        }

        const aa = c._animalAttack;
        if (aa && aa.state.stage === 'leap' && aa.state.rangePx != null) {
          const st = aa.state;
          const headX = c.x + Math.cos(st.angle) * st.headOffsetPx;
          const headY = c.y + Math.sin(st.angle) * st.headOffsetPx;
          _drawDebugCone(headX, headY, st.angle, st.rangePx, st.halfConeRad, DEBUG_ATTACK_COLOR_LEAP);
        } else if (c.telegraphState) {
          _drawDebugCircle(c.x, c.y, def.attackRangePx,
            c.telegraphState === 'strike' ? DEBUG_ATTACK_COLOR_STRIKE : DEBUG_ATTACK_COLOR_WINDUP, true);
        }

        // Deadzone fans — the two camera-relative angle bands where the PNG
        // plane lerps through rather than tracking freely. Each perp is stored
        // in Three.js rotation.y space; convert to world-space angle via
        //   worldAngle = π/2 − rotY
        // so the sector maps back into the same atan2 space as c.facing.
        const dzR = TILE * 0.65;
        for (const P_rotY of cameraRelativeCreaturePerps()) {
          const wc = Math.PI / 2 - P_rotY;
          _drawDebugArcSector(c.x, c.y, wc - CREATURE_PERP_DEAD_RAD, wc + CREATURE_PERP_DEAD_RAD,
            dzR, DEBUG_DEADZONE_EDGE_COLOR, DEBUG_DEADZONE_FILL_COLOR);
        }
        // Current PNG plane direction — where the sprite is visually facing
        // right now (may lag or differ from the prism/group rotation).
        if (c.pngRot !== undefined) {
          const pngWorldAngle = Math.PI / 2 - c.pngRot;
          _drawDebugLine(c.x, c.y,
            c.x + Math.cos(pngWorldAngle) * dzR,
            c.y + Math.sin(pngWorldAngle) * dzR,
            DEBUG_PNG_ROT_COLOR, false);
        }
      }

      function drawDebugHitboxes() {
        if (!s_showHitboxes) return;
        _drawDebugSquare(player.x, player.y, playerModelWidthTiles() * TILE / 2, DEBUG_HITBOX_COLOR_PLAYER, false);
        for (const c of hostileObjects) {
          if (c.health <= 0 || c.areaId !== currentArea) continue;
          _drawCreatureDebug(c, DEBUG_HITBOX_COLOR_HOSTILE);
        }
        for (const c of companionObjects) {
          if (c.health <= 0 || c.areaId !== currentArea) continue;
          _drawCreatureDebug(c, DEBUG_HITBOX_COLOR_COMPANION);
        }
      }

      // ── 2D overlay draw (rain curtain + ripples on overlay canvas) ─
      function drawOverlays() {
        const rect = _threeRect;
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

        drawCombatConeReticle();
        drawWeaponTrailEffects();
        drawActionTileEffects();
        drawActionParticles();

        if (lightningAlpha > 0) {
          octx.fillStyle = `rgba(220,240,255,${lightningAlpha * 0.35})`;
          octx.fillRect(0, 0, W, H);
        }

        drawDebugHitboxes();
      }

      function markTileDirty(col, row) {
        _invalidateCropList();
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
        checkTothalShift();
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

      function recomputeWater(decayOnly, targetGrid = grid, rows = ROWS, cols = COLS) {
        const str = calendar.rainStrength || 1;
        const isRaining = calendar.isRaining && !decayOnly;

        // Pass 1: rain + absorption + evaporation + south-edge runoff
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const t = targetGrid[row][col];
            if (isSolid(t.type)) continue;
            t.flow = false;

            // Rivers/streams are a permanent water body, not part of the
            // irrigation sim — always full, never absorbed/evaporated/drained.
            if (t.type === TileType.RIVER || t.type === TileType.STREAM) {
              t.water = MAX_WATER;
              continue;
            }

            if (isRaining) {
              const rainMul = t.type === TileType.TRENCH ? 2.0
                            : t.type === TileType.PADDY  ? 1.4 : 1.0;
              t.water += RAIN_RATE * str * rainMul;

              // Rain gradually silts trenches back in; once fully silted the
              // trench reverts to plain grass (single-tap dig restores depth to 1).
              if (t.type === TileType.TRENCH) {
                t.depth = Math.max(0, (t.depth ?? 1) - TRENCH_SILT_RATE * str);
                if (t.depth <= 0) { t.type = TileType.GRASS; t.depth = 0; }
              }
            }

            // Soil absorption
            const absorb = ABSORB_RATE[t.type] ?? 0.012;
            t.water = Math.max(0, t.water - absorb);

            // Evapotranspiration — slow background loss on all tiles
            t.water = Math.max(0, t.water - EVAP_RATE);

            // South-edge runoff — bottom 2 rows drain aggressively (gravity outlet)
            if (row >= rows - 2) {
              const runoffRate = row === rows - 1 ? 0.08 : 0.03;
              t.water = Math.max(0, t.water - runoffRate);
            }

            t.water = Math.min(tileWaterCapacity(t), t.water);
          }
        }

        // Pass 2: cross-tile flow — process south→north for southward bias
        const dirs = [
          { dc:  0, dr:  1 },  // south
          { dc:  1, dr:  0 },  // east
          { dc: -1, dr:  0 },  // west
          { dc:  0, dr: -1 },  // north
        ];

        for (let row = rows - 1; row >= 0; row--) {
          for (let col = 0; col < cols; col++) {
            const t = targetGrid[row][col];
            // Rivers/streams donate no water to neighbours — contained body, no spillover.
            if (isSolid(t.type) || t.water <= 0 || t.type === TileType.RIVER || t.type === TileType.STREAM) continue;

            let surfA = floorZ(t.type, t.depth) + t.water;

            for (const { dc, dr } of dirs) {
              const nc = col + dc, nr = row + dr;
              if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
              const n = targetGrid[nr][nc];
              if (isSolid(n.type)) continue;

              const surfB = floorZ(n.type, n.depth) + n.water;
              const head  = surfA - surfB;
              if (head <= 0.001) continue;

              // A silted-in (shallow) trench pulls water less eagerly than a fresh one.
              const bonus = (n.type === TileType.TRENCH) ? TRENCH_FLOW_BONUS * Math.max(0.15, n.depth ?? 1) : 1.0;
              let transfer = Math.min(head * FLOW_RATE * bonus * 0.5, t.water);
              transfer = Math.min(transfer, tileWaterCapacity(n) - n.water);
              if (transfer <= 0) continue;

              t.water -= transfer;
              n.water += transfer;
              surfA = floorZ(t.type, t.depth) + t.water; // update after transfer
              if (n.type === TileType.TRENCH) n.flow = true;
              if (t.type === TileType.TRENCH) t.flow = true;
              // Don't break — allow multiple transfers per tick for faster spread
            }
          }
        }

        // Pass 3: clamp
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const t = targetGrid[row][col];
            t.water = clamp(t.water, 0, tileWaterCapacity(t));
          }
        }

        // Signal the matching mesh updater to do a full refresh this frame.
        if (targetGrid === townGrid) _townWaterSimDirty = true;
        else _waterSimDirty = true;
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
        if (!toolActions[tool]) return;
        // Picking a tool through any of the normal paths (arc, digit keys,
        // scroll) while the weapon quick-switch is engaged cancels its
        // "return to X" memory — there's nothing sensible left to return to.
        if (tool !== 'weapon') weaponQuickSwitchSaved = null;
        activeTool = tool;
        const actions = toolActions[tool];
        if (!actions.includes(activeAction)) activeAction = actions[0];
        const equipped = equipmentSlots[tool];
        const def = TOOL_ITEM_DEFS[equipped];
        const fallbackIcon = { shovel:'⛏️', hoe:'🪓', axe:'🪓', pick:'⛏️', harpoon:'🎣', weapon:'🗡️', machete:'🗡️' }[tool] || '🔧';
        const label = def?.label || { shovel:'Shovel', hoe:'Hoe', axe:'Axe', pick:'Pick', harpoon:'Harpoon', weapon:'Weapon', machete:'Weapon' }[tool] || tool;
        toolBtnIcon.innerHTML  = toolSelectIconHTML(def, fallbackIcon, '0.85em');
        toolBtnLabel.textContent = label;
        toolPickBtns.forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
        // Swap visible tool mesh
        Object.values(toolMeshMap).forEach(m => { if (m) toolHolder.remove(m); });
        if (toolMeshMap[tool]) toolHolder.add(toolMeshMap[tool]);
        closeToolPicker();
        refreshActionBar();
        refreshWeaponSwitchBtn();
        const msg = `${label} selected.`;
        lastActionMessage = msg;
        showToast(msg, true);
      }

      // Weapon quick-switch icon always shows whatever's actually equipped in
      // the weapon slot (not necessarily the active tool) — its .active class
      // (toggled every frame in updateMovement) is what shows the current
      // in/out state.
      function refreshWeaponSwitchBtn() {
        if (!btnWeaponSwitchIcon) return;
        const def = TOOL_ITEM_DEFS[equipmentSlots.weapon];
        btnWeaponSwitchIcon.innerHTML = toolSelectIconHTML(def, '🗡️', '0.85em');
      }

      // Press once: snapshot whatever tool/item is currently active and jump
      // straight to the weapon slot. Press again: restore that snapshot.
      // This is the only path that sets activeTool to 'weapon' now — it's
      // been removed from WHEEL_SLOTS (the regular tool-select cycle).
      function toggleQuickWeaponSwitch() {
        if (weaponQuickSwitchSaved) {
          const saved = weaponQuickSwitchSaved;
          weaponQuickSwitchSaved = null;
          // Restore the underlying tool slot first (icon/mesh/actions), then
          // re-enter item mode on top of it if that's what was active.
          setActiveTool(saved.tool);
          if (saved.heldMode === 'item') {
            heldMode = 'item';
            activeItemIndex = saved.itemIndex;
            refreshItemScroll();
            refreshActionBar();
          } else {
            heldMode = 'tool';
          }
        } else {
          weaponQuickSwitchSaved = { heldMode, tool: activeTool, itemIndex: activeItemIndex };
          heldMode = 'tool';
          setActiveTool('weapon');
        }
      }

      function setActiveAction(action) {
        activeAction = action;
        refreshActionBar();
        useActiveAction();
      }

      // ── Tool wheel (radial picker) ─────────────────────────
      const toolWheelOverlay = document.getElementById('toolWheelOverlay');
      const toolWheelEl      = document.getElementById('toolWheel');
      // 'weapon' deliberately excluded — it's reachable only via the
      // dedicated weapon quick-switch (toggleQuickWeaponSwitch), not the
      // regular tool-select cycle.
      const WHEEL_SLOTS  = ['shovel', 'hoe', 'axe', 'pick', 'harpoon'];
      const WHEEL_RADIUS = 72; // px — distance from center to each spoke button

      let toolPickerOpen = false;

      function openToolPicker() {
        toolPickerOpen = true;
        const rect = toolBtn.getBoundingClientRect();
        const cx = rect.left + rect.width  / 2;
        const cy = rect.top  + rect.height / 2;

        // Clamp center so all spoke buttons stay fully on screen
        const margin = WHEEL_RADIUS + 32;
        const wcx = Math.max(margin, Math.min(window.innerWidth  - margin, cx));
        const wcy = Math.max(margin, Math.min(window.innerHeight - margin, cy));

        toolWheelEl.innerHTML = '';
        const n = WHEEL_SLOTS.length;
        WHEEL_SLOTS.forEach((slot, i) => {
          const angle = (i / n) * Math.PI * 2 - Math.PI / 2; // 0 = top
          const sx = wcx + Math.cos(angle) * WHEEL_RADIUS;
          const sy = wcy + Math.sin(angle) * WHEEL_RADIUS;

          const equippedKey = equipmentSlots[slot];
          const eqDef = equippedKey ? TOOL_ITEM_DEFS[equippedKey] : null;
          const icon  = eqDef?.icon  || ({shovel:'⛏️',hoe:'🪓',weapon:'🗡️',axe:'🪓',pick:'⛏️',harpoon:'🎣'})[slot] || '🔧';
          const label = ({shovel:'Shovel',hoe:'Hoe',weapon:'Weapon',axe:'Axe',pick:'Pick',harpoon:'Harpoon'})[slot] || slot;

          const spoke = document.createElement('div');
          spoke.className = 'tw-spoke';
          spoke.style.cssText = `left:${sx}px;top:${sy}px;animation-delay:${i * 0.018}s`;

          const btn = document.createElement('button');
          btn.className = 'tw-btn' + (activeTool === slot ? ' active' : '');
          btn.textContent = icon;

          const chip = document.createElement('span');
          chip.className = 'tw-chip';
          chip.textContent = label;

          spoke.appendChild(btn);
          spoke.appendChild(chip);

          const pick = () => { setActiveTool(slot); closeToolPicker(); };
          btn.addEventListener('pointerup', (e) => { e.stopPropagation(); pick(); });

          toolWheelEl.appendChild(spoke);
        });

        toolWheelOverlay.classList.add('open');
        toolWheelEl.classList.add('open');
        toolBtn.setAttribute('aria-expanded', 'true');
        toolBtn.style.borderColor = 'rgba(249,226,138,0.6)';
      }

      function closeToolPicker() {
        toolPickerOpen = false;
        toolWheelOverlay.classList.remove('open');
        toolWheelEl.classList.remove('open');
        toolWheelEl.innerHTML = '';
        toolBtn.setAttribute('aria-expanded', 'false');
        toolBtn.style.borderColor = '';
      }

      // ── Outer arch — tool & item arc-dial ─────────────────
      {
        const _itemBtn = document.getElementById('itemBtn');
        const ARC_S = 175, ARC_E = 95;
        const mobileControls = window.SCRATCHBONES_CONFIG?.game?.mobileControls || {};
        const configuredSafeMarginPx = Number(mobileControls.safeMarginPx);
        const SAFE_M = Number.isFinite(configuredSafeMarginPx) ? configuredSafeMarginPx : 0;
        const outerArchRadiusClamp = mobileControls.outerArch?.radiusClamp || {};

        function _clampedVmin({ minPx, vmin, maxPx }) {
          const viewportMin = Math.min(window.innerWidth, window.innerHeight);
          const configuredVmin = Number(vmin);
          const preferredPx = viewportMin * (Number.isFinite(configuredVmin) ? configuredVmin : 0) / 100;
          const lowerPx = Number(minPx);
          const upperPx = Number(maxPx);
          if (![preferredPx, lowerPx, upperPx].every(Number.isFinite)) return 0;
          return Math.min(upperPx, Math.max(lowerPx, preferredPx));
        }

        function _outerR() {
          const colPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--col'));
          return Number.isFinite(colPx) && colPx > 0 ? colPx * 10 : _clampedVmin(outerArchRadiusClamp);
        }
        function _arcPt(deg) {
          const r = _outerR(), a = deg * Math.PI / 180;
          return { x: window.innerWidth  + Math.cos(a) * r - SAFE_M,
                   y: window.innerHeight - Math.sin(a) * r - SAFE_M };
        }
        function _cornerAng(px, py) {
          return Math.atan2(-(py - window.innerHeight), px - window.innerWidth) * 180 / Math.PI;
        }

        let _arcEls = [], _arcBd = null, _arcOpen = null, _arcSlots = [], _arcActive = -1;
        let _fadingEls = [];

        function _clearArc() {
          if (_arcBd) { _arcBd.remove(); _arcBd = null; }
          _arcEls.forEach(e => e.remove()); _arcEls = [];
          _fadingEls.forEach(e => e.remove()); _fadingEls = [];
          _arcSlots = []; _arcActive = -1; _arcOpen = null;
          toolBtn.style.visibility = '';
          if (_itemBtn) _itemBtn.style.visibility = '';
        }

        function _mkSlot(deg, icon, label, extra) {
          const pt = _arcPt(deg);
          const el = document.createElement('div');
          el.className = 'arc-slot' + (extra ? ' ' + extra : '');
          el.style.cssText = `position:fixed;left:${pt.x}px;top:${pt.y}px;z-index:201;pointer-events:none;`;
          el.innerHTML = `<span class="arc-icon">${icon}</span>`
                       + (label ? `<span class="arc-label">${label}</span>` : '');
          document.body.appendChild(el);
          _arcEls.push(el);
          return el;
        }

        function _setActive(idx) {
          if (_arcActive === idx) return;
          if (_arcSlots[_arcActive]) _arcSlots[_arcActive].el.classList.remove('arc-active');
          _arcActive = idx;
          if (_arcSlots[idx]) _arcSlots[idx].el.classList.add('arc-active');
        }

        function _openToolArc() {
          _clearArc(); _arcOpen = 'tool';
          if (_itemBtn) _itemBtn.style.visibility = 'hidden';
          _arcBd = document.createElement('div');
          _arcBd.className = 'arc-backdrop';
          document.body.appendChild(_arcBd);
          const n = WHEEL_SLOTS.length, step = (ARC_S - ARC_E) / (n - 1);
          WHEEL_SLOTS.forEach((slot, i) => {
            const deg = ARC_S - i * step;
            const eq = equipmentSlots[slot], def = eq ? TOOL_ITEM_DEFS[eq] : null;
            const fallbackIcon = {shovel:'⛏️',hoe:'🪓',weapon:'🗡️',axe:'🪓',pick:'⛏️',harpoon:'🎣'}[slot] || '🔧';
            const icon  = toolSelectIconHTML(def, fallbackIcon, '1.4em');
            const label = {shovel:'Shovel',hoe:'Hoe',weapon:'Weapon',axe:'Axe',pick:'Pick',harpoon:'Harpoon'}[slot] || slot;
            const el = _mkSlot(deg, icon, label, activeTool === slot ? 'arc-active' : '');
            _arcSlots.push({ angle: deg, el, data: slot });
            if (activeTool === slot) _arcActive = i;
          });
        }

        let _lastHeldTool = activeTool;
        let _iScroll = 0, _iScrollT = null, _iScrollDir = 0;
        const ITEM_VIS = 5;

        function _buildItemSlots() {
          const stacks = getInventoryStackItems(), total = stacks.length;
          const slots = [];
          if (_iScroll > 0) slots.push({ type:'arrow', dir:-1, icon:'◀', label:'' });
          for (let i = 0; i < ITEM_VIS && _iScroll + i < total; i++)
            slots.push({ type:'item', index:_iScroll+i, icon:stacks[_iScroll+i].icon, label:stacks[_iScroll+i].label });
          if (_iScroll + ITEM_VIS < total) slots.push({ type:'arrow', dir:1, icon:'▶', label:'' });
          const sn = slots.length, step = sn > 1 ? (ARC_S - ARC_E) / (sn - 1) : 0;

          const oldByKey = new Map(_arcSlots.map(s => [
            s.data.type === 'arrow' ? `a${s.data.dir}` : `i${s.data.index}`, s
          ]));
          const kept = new Set(), newSlots = [];

          slots.forEach((s, i) => {
            const deg = ARC_S - i * step, pt = _arcPt(deg);
            const k = s.type === 'arrow' ? `a${s.dir}` : `i${s.index}`;
            const extra = s.type === 'arrow' ? 'arc-arrow' : (s.index === activeItemIndex ? 'arc-active' : '');
            if (oldByKey.has(k)) {
              const old = oldByKey.get(k); kept.add(k);
              old.el.style.left = pt.x + 'px'; old.el.style.top = pt.y + 'px';
              old.el.className = 'arc-slot' + (extra ? ' ' + extra : '');
              newSlots.push({ angle: deg, el: old.el, data: s });
            } else {
              const el = document.createElement('div');
              el.className = 'arc-slot' + (extra ? ' ' + extra : '');
              el.style.cssText = `position:fixed;left:${pt.x}px;top:${pt.y}px;z-index:201;pointer-events:none;opacity:0;`;
              el.innerHTML = `<span class="arc-icon">${s.icon}</span>`
                           + (s.label ? `<span class="arc-label">${s.label}</span>` : '');
              document.body.appendChild(el);
              _arcEls.push(el);
              requestAnimationFrame(() => { el.style.opacity = '1'; });
              newSlots.push({ angle: deg, el, data: s });
            }
          });

          _arcSlots.forEach(s => {
            const k = s.data.type === 'arrow' ? `a${s.data.dir}` : `i${s.data.index}`;
            if (!kept.has(k)) {
              s.el.style.opacity = '0';
              _arcEls = _arcEls.filter(e => e !== s.el);
              _fadingEls.push(s.el);
              const _el = s.el;
              setTimeout(() => { _el.remove(); _fadingEls = _fadingEls.filter(f => f !== _el); }, 150);
            }
          });

          _arcSlots = newSlots;
          _arcActive = newSlots.findIndex(s => s.data.type === 'item' && s.data.index === activeItemIndex);
        }

        function _openItemArc() {
          _clearArc(); _arcOpen = 'item';
          toolBtn.style.visibility = 'hidden';
          _arcBd = document.createElement('div');
          _arcBd.className = 'arc-backdrop';
          document.body.appendChild(_arcBd);
          _iScroll = Math.max(0, activeItemIndex - Math.floor(ITEM_VIS / 2));
          _iScrollDir = 0;
          _buildItemSlots();
        }

        function _arcMove(px, py) {
          if (!_arcOpen || !_arcSlots.length) return;
          const ang = Math.max(ARC_E, Math.min(ARC_S, _cornerAng(px, py)));
          let best = 0, bd = Infinity;
          _arcSlots.forEach((s, i) => { const d = Math.abs(s.angle - ang); if (d < bd) { bd = d; best = i; } });
          if (_arcOpen === 'item') {
            const newDir = _arcSlots[best]?.data.type === 'arrow' ? _arcSlots[best].data.dir : 0;
            if (newDir !== _iScrollDir) {
              _iScrollDir = newDir;
              if (_iScrollT) { clearInterval(_iScrollT); _iScrollT = null; }
              if (newDir !== 0) {
                _iScrollT = setInterval(() => {
                  _iScroll = Math.max(0, Math.min(getInventoryStackItems().length - ITEM_VIS, _iScroll + _iScrollDir));
                  _buildItemSlots();
                }, 200);
              }
            }
          }
          _setActive(best);
        }

        function _arcUp() {
          if (_iScrollT) { clearInterval(_iScrollT); _iScrollT = null; }
          if (!_arcOpen) return;
          const slot = _arcSlots[_arcActive];
          if (_arcOpen === 'tool' && slot) {
            heldMode = 'tool'; _lastHeldTool = slot.data;
            setActiveTool(slot.data); // calls refreshActionBar internally
          } else if (_arcOpen === 'item' && slot?.data.type === 'item') {
            heldMode = 'item';
            activeItemIndex = slot.data.index;
            refreshItemScroll(); refreshActionBar();
          }
          _clearArc();
        }

        window._desktopSelectionArc = {
          openTool() { if (_arcOpen !== 'tool') _openToolArc(); },
          openItem() { if (_arcOpen !== 'item') _openItemArc(); },
          scrollTool(dir) {
            if (_arcOpen !== 'tool') _openToolArc();
            const idx = WHEEL_SLOTS.indexOf(activeTool);
            const next = (idx + dir + WHEEL_SLOTS.length) % WHEEL_SLOTS.length;
            heldMode = 'tool';
            _lastHeldTool = WHEEL_SLOTS[next];
            setActiveTool(WHEEL_SLOTS[next]);
            _arcSlots.forEach((s, i) => {
              const active = s.data === activeTool;
              s.el.classList.toggle('arc-active', active);
              if (active) _arcActive = i;
            });
          },
          scrollItem(dir) {
            if (_arcOpen !== 'item') _openItemArc();
            heldMode = 'item';
            cycleActiveInventoryItem(dir);
            refreshItemScroll(); refreshActionBar();
            _iScroll = Math.max(0, Math.min(getInventoryStackItems().length - ITEM_VIS, activeItemIndex - Math.floor(ITEM_VIS / 2)));
            _buildItemSlots();
            _arcSlots.forEach((s, i) => {
              const active = s.data.type === 'item' && s.data.index === activeItemIndex;
              s.el.classList.toggle('arc-active', active);
              if (active) _arcActive = i;
            });
          },
          close() { _clearArc(); }
        };

        let _tPtId = null, _tHeld = false, _tTimer = null, _tDx = 0, _tDy = 0, _tMoved = false;
        toolBtn.addEventListener('pointerdown', ev => {
          if (_tPtId !== null) return;
          _tPtId = ev.pointerId; _tHeld = false; _tMoved = false;
          _tDx = ev.clientX; _tDy = ev.clientY;
          toolBtn.setPointerCapture(ev.pointerId);
          _tTimer = setTimeout(() => { _tHeld = true; _openToolArc(); }, 350);
          ev.preventDefault();
        });
        toolBtn.addEventListener('pointermove', ev => {
          if (ev.pointerId !== _tPtId) return;
          if (!_tMoved && Math.hypot(ev.clientX - _tDx, ev.clientY - _tDy) > 6) _tMoved = true;
          if (_arcOpen === 'tool') _arcMove(ev.clientX, ev.clientY);
        });
        toolBtn.addEventListener('pointerup', ev => {
          if (ev.pointerId !== _tPtId) return;
          _tPtId = null;
          if (_tTimer) { clearTimeout(_tTimer); _tTimer = null; }
          if (_arcOpen === 'tool') _arcUp();
          else if (!_tHeld && !_tMoved && heldMode === 'item') {
            // Tap while in item mode → return to last held tool
            heldMode = 'tool';
            setActiveTool(_lastHeldTool); // calls refreshActionBar internally
          }
          _tHeld = false; _tMoved = false;
        });
        toolBtn.addEventListener('pointercancel', ev => {
          if (ev.pointerId !== _tPtId) return;
          _tPtId = null;
          if (_tTimer) { clearTimeout(_tTimer); _tTimer = null; }
          _clearArc(); _tHeld = false; _tMoved = false;
        });

        if (_itemBtn) {
          let _iPtId = null, _iHeld = false, _iTimer = null, _iDx = 0, _iDy = 0, _iMoved = false;
          _itemBtn.addEventListener('pointerdown', ev => {
            if (_iPtId !== null) return;
            _iPtId = ev.pointerId; _iHeld = false; _iMoved = false;
            _iDx = ev.clientX; _iDy = ev.clientY;
            _itemBtn.setPointerCapture(ev.pointerId);
            _iTimer = setTimeout(() => { _iHeld = true; _openItemArc(); }, 350);
            ev.preventDefault();
          });
          _itemBtn.addEventListener('pointermove', ev => {
            if (ev.pointerId !== _iPtId) return;
            if (!_iMoved && Math.hypot(ev.clientX - _iDx, ev.clientY - _iDy) > 6) _iMoved = true;
            if (_arcOpen === 'item') _arcMove(ev.clientX, ev.clientY);
          });
          _itemBtn.addEventListener('pointerup', ev => {
            if (ev.pointerId !== _iPtId) return;
            _iPtId = null;
            if (_iTimer) { clearTimeout(_iTimer); _iTimer = null; }
            if (_arcOpen === 'item') _arcUp();
            else if (!_iHeld && !_iMoved && heldMode === 'tool') {
              // Tap while in tool mode → switch to item mode
              _lastHeldTool = activeTool;
              heldMode = 'item';
              refreshItemScroll(); refreshActionBar();
            }
            _iHeld = false; _iMoved = false;
          });
          _itemBtn.addEventListener('pointercancel', ev => {
            if (ev.pointerId !== _iPtId) return;
            _iPtId = null;
            if (_iTimer) { clearTimeout(_iTimer); _iTimer = null; }
            if (_iScrollT) { clearInterval(_iScrollT); _iScrollT = null; }
            _clearArc(); _iHeld = false; _iMoved = false;
          });
        }
      }

      // ── Action bar update ──────────────────────────────────
      // ── Dynamic action stack ────────────────────────────────────────
      // Computes the full list of buttons to show, then rebuilds the DOM rows.
      // Buttons are packed into rows of 1, 2, 1, 2... (hex packing).
      // Each button: { icon, label, action, style, allowed }


      function computeActionButtons() {
        // NPC dialogue takes priority over tool use on touch controls and mirrors the primary-action keyboard path.
        if (nearbyNpcWalker && !farmEditMode) {
          const btns = [npcDialogueButton()];
          if (isGeneralStoreNpcOnDuty(nearbyNpcWalker)) btns.push(generalStoreButton());
          return btns;
        }

        // Interior: exit button near south door + interact button for interior world objects
        if (currentArea === 'interior') {
          const reticle  = getReticleTile();
          const nearExit = reticle.row >= INTERIOR_EXIT_ROW && reticle.col >= INTERIOR_EXIT_COL && reticle.col < INTERIOR_EXIT_COL + 2;
          const btns     = [];
          if (nearExit) btns.push({ icon: '🚪', label: 'Exit House', action: 'obj_exit_house', style: 'primary', allowed: true });
          const iObj = getWorldObjectAt(reticle.col, reticle.row);
          if (iObj) btns.push({ icon: '🔔', label: 'Interact', action: 'obj_interact', style: 'primary', allowed: true });
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

        // Zone: a climbable cliff face straight ahead takes priority over tool use.
        if (_isZoneArea(currentArea) && !player.climbing && getClimbTarget()) {
          return [{ icon: '🧗', label: 'Climb', action: 'climb', style: 'primary', allowed: true }];
        }

        const tile    = getActiveGrid()[reticle.row][reticle.col];
        const btns    = [];

        // 0. World object at reticle — its buttons take priority
        const obj = getWorldObjectAt(reticle.col, reticle.row);
        if (obj) {
          const objBtns = obj.getButtons(reticle);
          objBtns.forEach(b => btns.push(b));
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
          if (decorKey) {
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

        // Was farm-only (world objects didn't exist elsewhere) — now
        // unconditional so a lootable corpse's identity in any area (zones
        // included) still invalidates the cache and rebuilds its button.
        const obj = getWorldObjectAt(reticle.col, reticle.row);
        const nearbyNpcKey = nearbyNpcWalker?.rec?.id || nearbyNpcWalker?.root?.uuid || 'none';
        const nearbyNpcActivityKey = nearbyNpcWalker?.currentScheduleTarget?.activity || 'none';
        const nearbyNpcShopKey = nearbyNpcWalker && isGeneralStoreNpcOnDuty(nearbyNpcWalker) ? generalStoreAction() : 'none';
        const key = `${currentArea}|${heldMode}|${activeTool}|${activeItemIndex}|${reticle.col},${reticle.row}|${tile.type}|${tile.crop}|${tile.cropReady}|${obj ? obj.id : 'none'}|${processingFurnitureObjects.size}|${animalObjects.size}|${_pendingSpotTransition?.id || ''}|${nearbyNpcKey}|${nearbyNpcActivityKey}|${nearbyNpcShopKey}`;
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
          if (!el._abtDragInit) {
            el._abtDragInit = true;
            let _ptId = null, _cx = 0, _cy = 0, _sockR = 0;
            let _drag = false, _rtimer = null, _socket = null;
            let _chargeFiredOnPress = false;
            let _pressSlot = null; // 1 or 2 while a weapon tool-action button is mid-press
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
              // Navigation/interaction actions always fire; tool actions respect swing cooldown
              const isNavAction = act === npcDialogueAction() || act === generalStoreAction() || act === 'use_spot' || act === 'obj_exit_house' || act.startsWith('obj_');
              if (isNavAction || toolSwingT <= 0) useActiveAction();
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
              el.setPointerCapture(ev.pointerId);
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
              _chargeFiredOnPress = Boolean(act && !el.classList.contains('abt-hidden') && wouldStartCharge(activeTool, act));
              if (_chargeFiredOnPress) {
                activeAction = act;
                actionHeldDown = true;
                _abtFire();
              } else {
                actionHeldDown = true;
                _pressSlot = _weaponSlotFor(act);
                if (_pressSlot) window.Combat.input.pressStart(_pressSlot);
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
              if (_rtimer) { clearInterval(_rtimer); _rtimer = null; }
              _stack.classList.remove('drag-active');
              if (_socket) { _socket.remove(); _socket = null; }
              el.style.transition = 'transform 0.14s ease-out';
              el.style.transform  = 'translate(50%, 50%)';
              setTimeout(() => { el.style.transition = ''; el.style.transform = ''; }, 150);
              if (!_drag && !_chargeFiredOnPress) {
                if (_pressSlot) window.Combat.input.pressEnd(_pressSlot);
                else _abtFire();
              }
              _drag = false;
              _chargeFiredOnPress = false;
              _pressSlot = null;
            }

            el.addEventListener('pointerup', _abtUp);
            el.addEventListener('pointercancel', _abtUp);
          }
        }

        if (heldMode === 'item') {
          // Item mode: all actions spread across all 5 arch positions
          applyAbt('btnAction1',    btns[0], 0);
          applyAbt('btnAction2',    btns[1], 1);
          applyAbt('btnAction3',    btns[2], 2);
          applyAbt('btnItemAction1', btns[3], 3);
          applyAbt('btnItemAction2', btns[4], 4);
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
        if (action === 'dig')   return tile.type === TileType.TRENCH ? 'Redig' : 'Dig';
        if (action === 'fill')  return 'Fill';
        if (action === 'raise') return tile.type === TileType.RAISED ? 'Lower' : 'Raise';
        if (action === 'till')  return tile.type === TileType.TILLED ? 'Untill' : 'Till';
        if (action === 'smooth') return 'Smooth';
        if (action === 'cut')   return 'Cut';
        if (action === 'slash') return 'Slash 3×';
        if (action === 'chop')  return 'Chop';
        if (action === 'hack')  return 'Hack 3×';
        if (action === 'harvest') return tile.cropReady ? '✓ Harvest' : 'Growing';
        if (action === 'fish') return 'Fish';
        if (action.startsWith('place_')) return 'Place';
        if (action.startsWith('obj_process_')) return 'Process';
        return action;
      }

      // ── Item scroll ────────────────────────────────────────
      function refreshItemScroll() {
        const stacks = getInventoryStackItems();
        const n = stacks.length;
        const iBtnEl = document.getElementById('itemBtn');
        if (n === 0) {
          itemIcon.textContent  = '□';
          itemName.textContent  = 'EMPTY';
          itemCount.textContent = '×0';
          itemCount.className   = 'is-count empty';
          if (iBtnEl) iBtnEl.textContent = '□';
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
        if (iBtnEl) iBtnEl.textContent = curr.icon;
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
        const equipped = equipmentSlots[tool];
        if (equipped && TOOL_ITEM_DEFS[equipped]) return TOOL_ITEM_DEFS[equipped].icon;
        return { shovel:'⛏️', hoe:'🪓', axe:'🪓', pick:'⛏️', harpoon:'🎣', weapon:'🗡️', machete:'🗡️', seeds:'🌱' }[tool] || '❔';
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
        const equipped = equipmentSlots[tool];
        const def = equipped ? TOOL_ITEM_DEFS[equipped] : null;
        if (def) return `${def.icon} ${def.label}`;
        return { shovel:'⛏️ Shovel', hoe:'🪓 Hoe', axe:'🪓 Axe', pick:'⛏️ Pick', harpoon:'🎣 Harpoon', weapon:'🗡️ Weapon', machete:'🗡️ Weapon', seeds:'🌱 Seeds' }[tool] || tool;
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
          ...(window.__farmDebugLog || []).map(e => `[${e.t}] [${e.lvl}] ${e.msg}`)
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
        calendar.day = 17;
        calendar.time01 = 0.30;
        calendar.weather = 'rain';
        calendar.isRaining = true;
        calendar.rainStrength = 2;
        calendar.nextRainWindows = [{ start: 8, end: 14, strength: 2 }];
        Object.keys(inventory).forEach(key => { delete inventory[key]; });
        Object.assign(inventory, { ...STARTING_INVENTORY });
        clearPlacedProcessingFurniture();
        clearInteriorFurniture();
        clearAnimalObjects();
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
        if (gearInventory?.tools?.bronzehoe)  equipmentSlots.hoe    = 'bronzehoe';
        if (gearInventory?.tools?.pickshovel) equipmentSlots.shovel = 'pickshovel';
        if (gearInventory?.tools?.hatchet)    equipmentSlots.weapon = 'hatchet';
        if (gearInventory?.whistles?.length)  equipmentSlots.whistle = gearInventory.whistles[0].id;
        rebuildToolMeshes();
        refreshWeaponSwitchBtn();
        Object.values(toolMeshMap).forEach(m => { if (m) toolHolder.remove(m); });
        if (toolMeshMap[activeTool]) toolHolder.add(toolMeshMap[activeTool]);
        // Re-apply saved processing furniture from layout (crates keep their current position)
        try {
          const _rl = loadFarmLayout();
          if (_rl) {
            (_rl.furniture || []).forEach(({ key, col, row }) => {
              if (PROCESSING_FURNITURE_DEFS[key] && canPlaceFurnitureAt(col, row)) {
                const obj = makeProcessingFurniture(col, row, key);
                if (obj) { worldObjects.set(col + ',' + row, obj); processingFurnitureObjects.add(obj); }
              }
            });
            (_rl.decor || []).forEach(({ key, col, row, area }) => {
              const def = DECORATIVE_FURNITURE_DEFS[key];
              if (!def) return;
              const decorArea = area || 'farm';
              const tgt = decorArea === 'interior' ? interiorScene : scene;
              const r = makeDecorativeFurnitureMesh(col, row, key, tgt, decorArea);
              if (r) interiorFurnitureObjects.push({ key, col, row, mesh: r.mesh, light: r.light, sfxSource: r.sfxSource, area: decorArea });
            });
          }
        } catch {}
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

      document.getElementById('npcDialogueContinue')?.addEventListener('click', () => { if (dialogueOpen) advanceNpcDialogue(); });
      document.getElementById('npcDialogueLeave')?.addEventListener('click', () => { if (dialogueOpen) closeNpcDialogue(); });

      joystickZone.addEventListener('pointerdown', handleJoystickPointerDown);
      joystickZone.addEventListener('pointermove', handleJoystickPointerMove);
      joystickZone.addEventListener('pointerup', handleJoystickPointerUp);
      joystickZone.addEventListener('pointercancel', handleJoystickPointerUp);

      // Dodge button: a plain tap, dodging in the current facing direction.
      // Only shown (via .combat-active, toggled in updateMovement) while a
      // hostile is within auto-target range, since dodging is moot outside combat.
      dodgeBtn?.addEventListener('pointerdown', ev => {
        ev.preventDefault();
        performDodge(player.angle);
      });

      // Weapon quick-switch button: a plain tap toggles in/out of the
      // weapon tool slot (see toggleQuickWeaponSwitch). Always visible,
      // unlike dodgeBtn — this isn't combat-only, it's how you get *into*
      // combat stance to begin with.
      btnWeaponSwitch?.addEventListener('pointerdown', ev => {
        ev.preventDefault();
        toggleQuickWeaponSwitch();
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
          btnSwapTarget.setPointerCapture?.(ev.pointerId);
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
      const desktopHoldKeys = {
        q: { down: false, held: false, timer: null, arc: 'item' },
        e: { down: false, held: false, timer: null, arc: 'tool' }
      };
      function openDesktopHoldArc(key) {
        const state = desktopHoldKeys[key];
        if (!state || !state.down) return;
        state.held = true;
        if (state.arc === 'item') window._desktopSelectionArc?.openItem();
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
        if (wasHeld) window._desktopSelectionArc?.close();
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
      function runActionButtonAtSlot(slotIndex) {
        const btn = computeActionButtons()[slotIndex - 1];
        if (!btn) return;
        activeAction = btn.action;
        actionHeldDown = slotIndex === 1;
        useActiveAction();
      }
      function runInteractAction() {
        const toolSet = new Set(Object.values(toolActions).flat());
        const btn = computeActionButtons().find(b => b.allowed !== false && !toolSet.has(b.action) && !String(b.action || '').startsWith('plant_') && !String(b.action || '').startsWith('place_') && b.action !== 'harvest');
        if (!btn) return;
        activeAction = btn.action;
        useActiveAction();
      }
      function cycleActiveTool(delta) {
        const idx = WHEEL_SLOTS.indexOf(activeTool);
        const next = (idx + delta + WHEEL_SLOTS.length) % WHEEL_SLOTS.length;
        setActiveTool(WHEEL_SLOTS[next]);
      }
      function runInputAction(actionId, phase = 'press') {
        if (phase === 'release') {
          if (actionId === 'action1') actionHeldDown = false;
          return;
        }
        if (fishingMinigame?.active) {
          if (actionId === 'interact' || actionId === 'action1') fireFishingBridge();
          return;
        }
        if (menuOpen || farmEditMode) return;
        if (actionId === 'interact') { runInteractAction(); return; }
        const actionSlot = /^action(\d+)$/.exec(actionId);
        if (actionSlot) { runActionButtonAtSlot(Number(actionSlot[1])); return; }
        if (actionId === 'dodge') { performDodge(player.angle); return; }
        if (actionId === 'swapTarget') {
          const aimAngle = controllerLookActive ? controllerLookAngle
            : (isDesktop && mouseLookActive) ? mouseLookAngle
            : facingAngle;
          swapAutoTarget(aimAngle);
          return;
        }
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
        if (controllerLookActive) {
          controllerLookAngle = Math.atan2(ry, rx);
          targetAimAngle = controllerLookAngle;
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
        const heldShift = inputBindings.modeShifts.find(s => s.device === 'controller' && down.has(s.button));
        if (heldShift) controllerLookActive = false;
        for (const button of down) {
          if (gamepadState.previous.has(button) || button === heldShift?.button) continue;
          const actionId = getActionForButton('controller', button, heldShift);
          if (actionId) runInputAction(actionId, 'press');
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

      function renderInputSettings() {
        const desktopEl = document.getElementById('desktopInputBindings');
        const controllerEl = document.getElementById('controllerInputBindings');
        const shiftsEl = document.getElementById('modeShiftList');
        function renderDevice(el, device) {
          if (!el) return;
          el.innerHTML = '';
          for (const action of INPUT_DEFAULTS.actions) {
            const row = document.createElement('div'); row.className = 'input-binding-row';
            row.innerHTML = `<span class="settings-name">${action.label}</span>${device === 'controller' ? '<select class="settings-select"></select>' : `<button type="button" class="input-bind-btn">${buttonLabel(inputBindings[device][action.id])}</button>`}<div class="input-binding-warning"></div>`;
            const control = row.children[1]; const warn = row.querySelector('.input-binding-warning');
            if (device === 'controller') {
              control.add(new Option('Unbound', ''));
              CONTROLLER_INPUT_OPTIONS.forEach(code => control.add(new Option(buttonLabel(code), code)));
              control.value = inputBindings.controller[action.id] || '';
              control.addEventListener('change', () => { const conflict = bindingConflict(device, control.value, action.id); if (conflict) { warn.textContent = conflict; control.value = inputBindings.controller[action.id] || ''; } else { inputBindings.controller[action.id] = control.value || null; warn.textContent = ''; saveInputBindings(); } });
            } else {
              control.addEventListener('click', () => { control.classList.add('is-listening'); control.textContent = 'Press input…'; const once = ev => { ev.preventDefault(); const code = ev.code; const conflict = bindingConflict(device, code, action.id); if (conflict) warn.textContent = conflict; else { inputBindings[device][action.id] = code; warn.textContent = ''; saveInputBindings(); renderInputSettings(); } window.removeEventListener('keydown', once, true); }; window.addEventListener('keydown', once, true); });
            }
            el.appendChild(row);
          }
        }
        renderDevice(desktopEl, 'desktop'); renderDevice(controllerEl, 'controller');
        if (shiftsEl) {
          shiftsEl.innerHTML = '';
          inputBindings.modeShifts.forEach((shift, idx) => {
            const row = document.createElement('div'); row.className = 'mode-shift-row';
            row.innerHTML = `<input class="settings-select" value="${shift.label || ''}"><select class="settings-select"><option value="desktop">Desktop</option><option value="controller">Controller</option></select><input class="settings-select" value="${shift.button || ''}"><button type="button" class="settings-small-btn">Remove</button>`;
            row.children[1].value = shift.device || 'desktop';
            row.children[0].addEventListener('change', e => { shift.label = e.target.value; saveInputBindings(); });
            row.children[1].addEventListener('change', e => { shift.device = e.target.value; saveInputBindings(); });
            row.children[2].addEventListener('change', e => { shift.button = e.target.value; saveInputBindings(); });
            row.children[3].addEventListener('click', () => { inputBindings.modeShifts.splice(idx, 1); saveInputBindings(); renderInputSettings(); });
            shiftsEl.appendChild(row);
            const bindings = document.createElement('div'); bindings.className = 'input-bindings-grid';
            Object.entries(shift.bindings || {}).forEach(([button, actionId]) => {
              const bRow = document.createElement('div'); bRow.className = 'mode-shift-row';
              bRow.innerHTML = `<span class="settings-name">${buttonLabel(button)}</span><select class="settings-select"></select><span class="input-binding-warning"></span><button type="button" class="settings-small-btn">Remove</button>`;
              const select = bRow.children[1];
              INPUT_DEFAULTS.actions.forEach(action => select.add(new Option(action.label, action.id)));
              select.value = actionId;
              select.addEventListener('change', e => { shift.bindings[button] = e.target.value; saveInputBindings(); renderInputSettings(); });
              bRow.children[3].addEventListener('click', () => { delete shift.bindings[button]; saveInputBindings(); renderInputSettings(); });
              bindings.appendChild(bRow);
            });
            const add = document.createElement('button'); add.type = 'button'; add.className = 'settings-small-btn'; add.textContent = 'Add Shifted Binding';
            add.addEventListener('click', () => {
              add.classList.add('is-listening'); add.textContent = 'Press shifted input…';
              const once = ev => {
                ev.preventDefault();
                const manual = window.prompt?.('Input code (examples: RightStickLeft, RightTrigger, Button0)') || '';
                const button = manual.trim() || ev.code;
                const actionId = INPUT_DEFAULTS.actions[0]?.id || 'interact';
                const conflict = bindingConflict(shift.device || 'desktop', button, actionId, shift);
                if (!conflict) { shift.bindings = shift.bindings || {}; shift.bindings[button] = actionId; saveInputBindings(); }
                window.removeEventListener('keydown', once, true); renderInputSettings();
              };
              window.addEventListener('keydown', once, true);
            });
            bindings.appendChild(add);
            shiftsEl.appendChild(bindings);
          });
        }
      }
      document.getElementById('addModeShiftBtn')?.addEventListener('click', () => { inputBindings.modeShifts.push({ id: `custom-${Date.now()}`, label: 'Custom Shift', device: 'controller', button: 'Button4', bindings: {} }); saveInputBindings(); renderInputSettings(); });
      renderInputSettings();

      window.addEventListener('keydown', (event) => {
        const key = event.key.toLowerCase();
        if (fishingMinigame?.active) {
          if (key === 'escape') { event.preventDefault(); closeFishingMinigame(); return; }
          if (key === ' ' || key === 'enter') { event.preventDefault(); fireFishingBridge(); }
          return;
        }
        if (key === 'escape') { event.preventDefault(); if (dialogueOpen) { closeNpcDialogue(); return; } menuOpen ? closeMenu() : openMenu(); return; }
        if (menuOpen) return;
        const boundDesktopAction = getActionForButton('desktop', event.code);
        if (boundDesktopAction && !['KeyE', 'KeyQ'].includes(event.code)) {
          event.preventDefault();
          if (!event.repeat) runInputAction(boundDesktopAction, 'press');
          return;
        }
        if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd'].includes(key)) {
          event.preventDefault(); input.keys.add(key);
        }

        if (key === 'e') {
          event.preventDefault();
          if (isDesktop) { startDesktopHoldKey('e', event); return; }
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

        // Primary action: Space, Enter, or E (E only taps on desktop; hold opens tool selection)
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

        // Item scroll: , / . or Tab/Shift+Tab
        if (key === ',') {
          cycleActiveInventoryItem(-1);
          refreshItemScroll(); refreshActionBar();
        }
        if (key === '.' || key === 'tab') {
          event.preventDefault();
          cycleActiveInventoryItem(event.shiftKey ? -1 : 1);
          refreshItemScroll(); refreshActionBar();
        }

        // X: dodge in the current facing direction, with i-frames
        if (key === 'x') {
          event.preventDefault();
          performDodge(player.angle);
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
        if (key === 'e' && isDesktop) {
          event.preventDefault();
          const wasHeld = finishDesktopHoldKey('e');
          if (!wasHeld) { actionHeldDown = true; useActiveAction(); actionHeldDown = false; }
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
        if (key === ' ' || key === 'enter' || key === 'e') actionHeldDown = false;
      });

      // Scroll wheel: Q+wheel swaps items, E+wheel swaps tools, otherwise zooms the camera.
      function handleGameWheel(e, heldOnly = false) {
        if (menuOpen || farmEditMode) return false;
        const dir = e.deltaY > 0 ? 1 : -1;
        if (isDesktop && desktopHoldKeys.q.down) {
          e.preventDefault();
          openDesktopHoldArc('q');
          window._desktopSelectionArc?.scrollItem(-dir);
          return true;
        }
        if (isDesktop && desktopHoldKeys.e.down) {
          e.preventDefault();
          openDesktopHoldArc('e');
          window._desktopSelectionArc?.scrollTool(-dir);
          return true;
        }
        if (heldOnly) return false;
        e.preventDefault();
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

      // ── Camera drag-to-look: single-finger drag on mobile, Shift+mouse movement on desktop.
      // Nudges the look angle on top of the active mode's base framing, clamped to the configured range.
      let cameraDragPointerId = null;
      let cameraDragStartX = 0, cameraDragStartY = 0;
      let cameraDragStartAzimuthOffset = 0, cameraDragStartAngleOffset = 0;
      function cameraDragAllowed() {
        return !menuOpen && !farmEditMode && !dialogueZoomActive() && !fishingMinigame?.active;
      }
      function cameraDragRequested(e) {
        return e.pointerType === 'touch';
      }
      threeContainer.addEventListener('pointerdown', (e) => {
        if (!cameraDragRequested(e) || !cameraDragAllowed()) return;
        cameraDragPointerId = e.pointerId;
        cameraDragStartX = e.clientX;
        cameraDragStartY = e.clientY;
        cameraDragStartAzimuthOffset = cameraAzimuthOffsetDeg;
        cameraDragStartAngleOffset = cameraAngleOffsetDeg;
        threeContainer.setPointerCapture?.(e.pointerId);
      });
      threeContainer.addEventListener('pointermove', (e) => {
        if (e.pointerId !== cameraDragPointerId || !cameraDragAllowed()) return;
        const dx = e.clientX - cameraDragStartX;
        const dy = e.clientY - cameraDragStartY;
        const cfg = desktopControlsConfig();
        const degPerPx = Number.isFinite(Number(cfg.cameraRotateDegPerPx)) ? Number(cfg.cameraRotateDegPerPx) : 0.15;
        const clampDeg = Number.isFinite(Number(cfg.cameraRotateClampDeg)) ? Number(cfg.cameraRotateClampDeg) : 45;
        cameraAzimuthOffsetDeg = clamp(cameraDragStartAzimuthOffset + dx * degPerPx, -clampDeg, clampDeg);
        cameraAngleOffsetDeg   = clamp(cameraDragStartAngleOffset   - dy * degPerPx, -clampDeg, clampDeg);
        updateCameraPosition();
      });
      function clearCameraDragPointer(e) {
        if (e.pointerId === cameraDragPointerId) cameraDragPointerId = null;
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
          if (activeTool === 'weapon' && window.Combat?.input) {
            if (e.button === 0) { actionHeldDown = true; window.Combat.input.pressStart(1); }
            else if (e.button === 2) { window.Combat.input.pressStart(2); }
            return;
          }
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
        if (activeTool === 'weapon' && window.Combat?.input) {
          if (e.button === 0) { actionHeldDown = false; window.Combat.input.pressEnd(1); }
          else if (e.button === 2) { window.Combat.input.pressEnd(2); }
          return;
        }
        if (e.button === 0) actionHeldDown = false;
      });

      // Mouse-look: raycast cursor onto ground plane to get world position
      if (isDesktop) {
        threeContainer.addEventListener('mousemove', (e) => {
          if (e.shiftKey && cameraDragAllowed()) {
            const cfg = desktopControlsConfig();
            const degPerPx = Number.isFinite(Number(cfg.cameraRotateDegPerPx)) ? Number(cfg.cameraRotateDegPerPx) : 0.15;
            const clampDeg = Number.isFinite(Number(cfg.cameraRotateClampDeg)) ? Number(cfg.cameraRotateClampDeg) : 45;
            cameraAzimuthOffsetDeg = clamp(cameraAzimuthOffsetDeg - e.movementX * degPerPx, -clampDeg, clampDeg);
            cameraAngleOffsetDeg = clamp(cameraAngleOffsetDeg + e.movementY * degPerPx, -clampDeg, clampDeg);
            updateCameraPosition();
            return;
          }

          if (cameraDragPointerId !== null || e.shiftKey) return; // Shift+mouse movement is rotating the camera, not aiming
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
              targetAimAngle = mouseLookAngle;
              mouseLookActive = true;
              lastMouseMoveTime = performance.now();
            }
          }
        });
      }
      // ── Farm editor pointer handlers ──────────────────────────────
      threeContainer.addEventListener('pointerdown', (e) => {
        if (!farmEditMode || currentArea !== 'farm') return;
        e.stopPropagation();
        _editorPainting = true;
        const t = _screenToFarmTile(e.clientX, e.clientY);
        if (t) applyFarmEditBrush(t.col, t.row);
      });
      threeContainer.addEventListener('pointermove', (e) => {
        if (!farmEditMode || currentArea !== 'farm' || !_editorPainting) return;
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

      window.addEventListener('resize', () => { fitToAspect(); resizeCanvas(); updateCameraPosition(); if (menuOpen) auditInventorySizing(); });
      // Safety net for any inventory/pack change not already covered by an
      // explicit saveMemberWorldData() call above.
      window.addEventListener('beforeunload', () => { try { saveMemberWorldData(); } catch {} });
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
      loadAudioCueIndexes().then(() => resetAmbientCueTimer()).catch(() => resetAmbientCueTimer());
      _loadTownFromWorkspace().catch(() => {});
      debugLog('canvas resized, split wide-screen layout active, controls bound, animation loop requested');

      // ── Onboarding gate ────────────────────────────────────────────
      let gameStarted = false;

      async function spawnPlayerAvatar(playerData) {
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
        worldObjects.forEach(o => o.reset && o.reset());
        grid = createInitialGrid();
        // Module init already may have moved the shipping/supply crates per the
        // legacy-key layout — put them back to their hard defaults before
        // applying (or not finding) this world's own saved positions, so a
        // brand-new world can't inherit another world's crate placement.
        const DEFAULT_SELL_CRATE_COL = 2, DEFAULT_SELL_CRATE_ROW = ROWS - 3;
        const DEFAULT_SUPPLY_BOX_COL = 4, DEFAULT_SUPPLY_BOX_ROW = ROWS - 3;
        if (shippingBoxObject && (shippingBoxObject.col !== DEFAULT_SELL_CRATE_COL || shippingBoxObject.row !== DEFAULT_SELL_CRATE_ROW)) {
          worldObjects.delete(shippingBoxObject.col + ',' + shippingBoxObject.row);
          const nc = makeSellCrate(DEFAULT_SELL_CRATE_COL, DEFAULT_SELL_CRATE_ROW);
          shippingBoxObject = nc; worldObjects.set(nc.col + ',' + nc.row, nc);
        }
        if (supplyBoxObject && (supplyBoxObject.col !== DEFAULT_SUPPLY_BOX_COL || supplyBoxObject.row !== DEFAULT_SUPPLY_BOX_ROW)) {
          worldObjects.delete(supplyBoxObject.col + ',' + supplyBoxObject.row);
          const nb = makeSupplyBox(DEFAULT_SUPPLY_BOX_COL, DEFAULT_SUPPLY_BOX_ROW);
          supplyBoxObject = nb; worldObjects.set(nb.col + ',' + nb.row, nb);
        }
        const _worldLayout = loadFarmLayout();
        if (_worldLayout) applyFarmLayoutToGrid(_worldLayout);
        applyFarmLayoutObjects(_worldLayout); // repositions again if THIS world saved custom crate positions
        respawnWorldLivestock(); // after furniture, so occupancy checks see final tile state
        recomputeWater(false);

        // Non-gear inventory (resources) and pack clothing are world-scoped
        // per character — they stay behind in this world's member record
        // rather than following the character to another world.
        Object.keys(inventory).forEach(key => { delete inventory[key]; });
        Object.assign(inventory, Object.keys(playerData.nonGearInventory || {}).length
          ? { ...playerData.nonGearInventory }
          : { ...STARTING_INVENTORY });
        packClothing = [...(playerData.packClothing || [])];

        // NPC relationships/memory and quest progress are likewise world-scoped
        // per character.
        loadNpcRelationships(playerData);
        questProgress = { ...(playerData.questProgress || {}) };

        gearInventory = (playerData.gearInventory && typeof playerData.gearInventory === 'object')
          ? playerData.gearInventory
          : makeDefaultGear();
        if (!gearInventory.tools)    gearInventory.tools    = {};
        if (!gearInventory.clothing) gearInventory.clothing = { hat: null, hood: null, torso: null, overwear: null };
        if (!gearInventory.charms)   gearInventory.charms   = [];
        if (!gearInventory.whistles || !gearInventory.whistles.length) {
          gearInventory.whistles = [{ id: 'whistle_bingo', creatureKey: 'dabinggi-hound', name: 'Bingo' }];
        }
        ensureGearClothingCollection();
        // Set default equipment slot assignments
        if (gearInventory.tools.bronzehoe)  equipmentSlots.hoe    = equipmentSlots.hoe    || 'bronzehoe';
        if (gearInventory.tools.pickshovel) equipmentSlots.shovel = equipmentSlots.shovel || 'pickshovel';
        if (gearInventory.tools.hatchet)    equipmentSlots.weapon = equipmentSlots.weapon  || 'hatchet';
        if (gearInventory.whistles.length)  equipmentSlots.whistle = equipmentSlots.whistle || gearInventory.whistles[0].id;
        rebuildToolMeshes();
        refreshWeaponSwitchBtn();
        Object.values(toolMeshMap).forEach(m => { if (m) toolHolder.remove(m); });
        if (toolMeshMap[activeTool]) toolHolder.add(toolMeshMap[activeTool]);
        buildEquipmentSlots();
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
        gameStarted = true;
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

      window.Combat?.init({
        player,
        TILE,
        hostileObjects,
        companionObjects,
        getCurrentArea: () => currentArea,
        inCone,
        damageCreature,
        damagePlayer,
        applyKnockback,
        weaponAbility,
        combatConfig,
        resolveWeaponHit,
        findAutoTarget,
        canPlayerOccupy,
        canOccupyAt,
        setCreatureFrame,
        showToast,
        triggerWeaponSwingVisual,
        triggerWeaponHoldVisual,
        releaseWeaponSwingHold,
        cancelWeaponSwingHold,
        beginCombatLunge,
        spawnCombatTrailEffect,
        spawnBurstEffect,
        playCreatureBark,
        playCreatureClawHit,
        playWeaponSlashSfx,
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

      requestAnimationFrame(gameLoop);
    })();
