(() => {
  'use strict';

  // NPC dialogue CONTENT: text/token resolution, dialogue-tree and phrase-
  // pool selection, the typewriter effect, portrait rendering, and the
  // choice-button UI. Extracted out of game.js following the same
  // window.<Namespace> + init(deps) pattern as the previous passes.
  //
  // Deliberately narrower than "all NPC dialogue code": opening/closing a
  // conversation (openNpcDialogue/closeNpcDialogue) stays in game.js
  // because those two functions are tightly bound to systems that live
  // there too — camera mode/target, dialogue-zoom state, NPC staging, and
  // saveMemberWorldData() persistence — and pulling them out would mean
  // this module reaching back into camera/save internals rather than the
  // other way around. openNpcDialogue/closeNpcDialogue call into this
  // module's public methods (beginNpcConversation, renderDlgNode,
  // renderRelationshipHearts, stopNpcDialogueTypewriter, hideChoiceButtons,
  // dialogueSeatId) instead.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  const _npcDialogueEl      = document.getElementById('npcDialogue');
  const _npcPortraitCanvas  = document.getElementById('npcPortraitCanvas');
  const _npcDialogueNameEl  = document.getElementById('npcDialogueName');
  const _npcDialogueTextEl  = document.getElementById('npcDialogueText');
  const _npcDialogueHeartsEl = document.getElementById('npcDialogueHearts');
  const _arcContainerEl     = document.getElementById('arcContainer');

  // Dialogue-flow state — private to this module. (dialogueOpen and the
  // active walker reference stay in game.js since camera/staging code
  // there also reads/writes them — see deps.getDialogueOpen/
  // getDialogueWalker below.)
  let _dlgTree      = null;  // active tree object
  let _dlgNodeMap   = null;  // {id → node}
  let _dlgNode      = null;  // current node
  let _dlgNpcRec    = null;  // current NPC record
  let _dlgSeqStack  = [];    // [{seqNodeId, depthRemaining}]
  let _dialogueLines     = [];
  let _dialogueLineIdx   = 0;
  let _npcDialogueTypeTimers = [];
  let _npcDialogueSequenceId = 0;
  let _npcDialogueTypeText  = '';
  let _npcDialogueTypeIndex = 0;
  let _npcDialogueTypeUnits = []; // Syllable reveal queue consumed by _setNpcDialogueText().
  const _npcDlgState = new Map(); // npcId → {visitedSeqSlots:{seqId:[slotIdx,...]}, localNickname}
  const _npcBaseDispositions = {}; // npcId → baseDisposition from NPC database config
  let _favorRescaleApplied = true; // see loadNpcRelationships/_applyLegacyFavorRescale

  function npcDialogueTextConfig() {
    return window.SCRATCHBONES_CONFIG?.game?.npcDialogue?.text || {};
  }

  function npcDialogueLetterSfxConfig(rec = _dlgNpcRec || deps.getDialogueWalker()?.rec) {
    const audioCfg = window.AudioSystem?.gameAudioConfig();
    const dialogueCfg = { url: 'assets/audio/music/instruments/sfx_kurraya_pluck.m4a', ...(audioCfg.dialogueLetter || {}) }; // Defaults dialogue pulses to the bundled Kurraya pluck; audio.dialogueLetter.url can override/null this experiment.
    const npcOverrides = dialogueCfg.npcs || {};
    const speciesOverrides = dialogueCfg.species || {};
    const speciesId = rec?.appearance?.speciesId || rec?.speciesId || rec?.species || deps.getDialogueWalker()?.speciesId;
    return {
      ...dialogueCfg,
      ...(speciesId && speciesOverrides[speciesId] ? speciesOverrides[speciesId] : {}),
      ...(rec?.id && npcOverrides[rec.id] ? npcOverrides[rec.id] : {}),
      ...(rec?.dialogueLetterSfx || {})
    };
  }

  function npcDialogueTypewriterConfig() {
    const cfg = npcDialogueTextConfig().typewriter || {};
    // Keep malformed or unbounded authored values from turning one dialogue
    // into an accidentally glacial typewriter sequence.
    const finiteClamped = (value, fallback, min, max) => {
      const number = Number(value);
      return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
    };
    return {
      enabled: cfg.enabled !== false,
      msPerChar: finiteClamped(cfg.msPerChar, 22, 1, 250),
      syllablesPerSecond: finiteClamped(cfg.syllablesPerSecond, 6, 1, 20),
      punctuationPauseMs: finiteClamped(cfg.punctuationPauseMs, 120, 0, 2000),
      whitespacePauseMs: finiteClamped(cfg.whitespacePauseMs, 0, 0, 250)
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

  function getNpcDlgState(npcId) {
    if (!_npcDlgState.has(npcId)) _npcDlgState.set(npcId, { visitedSeqSlots: {}, localNickname: null, favor: _npcBaseDispositions[npcId] ?? 0, memory: [], heardTrees: [], heardPoolEntries: [] });
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
        favor:           rel.favor ?? (_npcBaseDispositions[npcId] ?? 0),
        memory:          [...(rel.memory || [])],
        heardTrees:      [...(rel.heardTrees || [])],
        heardPoolEntries:[...(rel.heardPoolEntries || [])],
      });
    }
    _favorRescaleApplied = !!playerData?.npcFavorRescaleApplied;
    if (!_favorRescaleApplied) {
      _applyLegacyFavorRescale(playerData);
      _favorRescaleApplied = true;
    }
  }

  // One-time migration for a world member saved before Friendship Tier was
  // unified onto the same -5..10 hearts scale favor already used
  // everywhere else (renderRelationshipHearts, authored dialogue
  // relationship:{min,max} conditions, npc-gifting.js's TIER_FAVOR, the
  // rapport→favor rollover) — see procedural-tasks.js. Such a save can
  // carry favor accumulated under the old, much larger tier thresholds
  // (single quest turn-ins of up to +85), which reads as nonsense/maxed-
  // out hearts now that both systems share one small scale. Every NPC's
  // favor resets to a clean 0; Kinami Kunji is the one authored exception
  // — she starts frosty (-2) toward anyone who isn't Mao'ao, same as
  // everyone else (0) if the player is. Runs once per member (gated by
  // npcFavorRescaleApplied, persisted alongside npcRelationships) — a
  // brand-new member is created with that flag already set, so it never
  // re-runs on saves made after this migration shipped.
  function _applyLegacyFavorRescale(playerData) {
    for (const st of _npcDlgState.values()) st.favor = 0;
    const isMaoAo = playerData?.appearance?.speciesId === 'mao-ao';
    getNpcDlgState('kinami_kunji').favor = isMaoAo ? 0 : -2; // force-create even if never met
  }

  function npcRelationshipsSnapshot() {
    const out = {};
    for (const [npcId, st] of _npcDlgState.entries()) {
      out[npcId] = {
        visitedSeqSlots: st.visitedSeqSlots,
        localNickname:   st.localNickname,
        favor:           st.favor || 0,
        memory:          st.memory || [],
        heardTrees:      st.heardTrees || [],
        heardPoolEntries:st.heardPoolEntries || [],
      };
    }
    return out;
  }

  // Appends a small memory entry an NPC "remembers" about this character —
  // ready for gift/dialogue-choice hooks to call into once those systems
  // record specific events, not just that a conversation happened.
  function recordNpcMemory(npcId, event) {
    if (!npcId) return;
    const st = getNpcDlgState(npcId);
    st.memory.push({ event, day: deps.calendar.day, ts: Date.now() });
    if (st.memory.length > 50) st.memory.shift();
  }

  // Favor "spillover" — helping (or upsetting) one NPC nudges the people
  // close to them too, like an informal faction web where an NPC can
  // belong to more than one circle at once. Two bond types, both derived
  // straight from data every NPC already has (no new authored relationship
  // graph needed):
  //   - household ("familiar"): NPCs sharing the same homeId. Tooth
  //     Hatayap's homeId is unumanuk_household (she lodges with that
  //     family as a refugee, despite her own surname) — helping her nudges
  //     favor with Teacup/Spearhead/Oddclaw/Binding too, and vice versa.
  //   - workplace ("friendly"): NPCs sharing the same
  //     scheduleHooks.workBuildingId, when that doesn't already overlap
  //     with a shared homeId. Hreesh, Jubmir, and Tooth all have
  //     workBuildingId 'inn' (Tooth waits tables there; Jubmir lodges
  //     there rent-free as Hreesh's friend) — a second, independent circle
  //     Tooth belongs to alongside her household one.
  // A given pair only ever gets the stronger of the two fractions if both
  // somehow apply (see relatedNpcBonds), and this never affects who counts
  // as "known" for the Relationships tab (js/relationships-panel.js) or
  // pops a reward toast — only actually talking to someone does that;
  // spillover just quietly pre-seeds favor for people you haven't met yet.
  const HOUSEHOLD_SPILLOVER_FRACTION = 0.25;
  const WORKPLACE_SPILLOVER_FRACTION = 0.15;

  function relatedNpcBonds(npcId) {
    const records = deps.getNpcRecords?.() || [];
    const source = records.find(r => r?.id === npcId);
    if (!source) return [];
    const bonds = new Map(); // relatedNpcId -> strongest applicable fraction
    for (const other of records) {
      if (!other?.id || other.id === npcId) continue;
      const sameHome = source.homeId && other.homeId === source.homeId;
      const sameWork = source.scheduleHooks?.workBuildingId && other.scheduleHooks?.workBuildingId === source.scheduleHooks.workBuildingId;
      if (!sameHome && !sameWork) continue;
      const fraction = sameHome ? HOUSEHOLD_SPILLOVER_FRACTION : WORKPLACE_SPILLOVER_FRACTION;
      if (!bonds.has(other.id) || bonds.get(other.id) < fraction) bonds.set(other.id, fraction);
    }
    return [...bonds.entries()];
  }

  // No gift/relationship-building system exists yet to call this from —
  // exposed as the entry point that one will use once built.
  //
  // _isSpillover is internal only (see relatedNpcBonds above) — a
  // spillover application never triggers further spillover, so a tightly
  // interconnected household/workplace can't cascade into a runaway favor
  // chain reaction.
  function adjustNpcFavor(npcId, amount, reason, _isSpillover = false) {
    if (!npcId) return;
    const st = getNpcDlgState(npcId);
    if (amount > 0) amount *= window.AlchemySystem?.getPositiveFavorMultiplier?.() || 1; // Love Potion hooks the one favor adjustment path.
    amount = Math.round(amount * 10) / 10;
    st.favor = (st.favor || 0) + amount;
    if (_isSpillover) return; // Quiet: no reward toast, no memory entry (see the header comment above).
    if (amount) window.WorldPopupText?.queueReward('favor', `${amount > 0 ? '+' : '-'}${Math.abs(amount)} Favor`);
    recordNpcMemory(npcId, reason || (amount >= 0 ? 'favor_up' : 'favor_down'));
    if (amount) {
      for (const [relatedId, fraction] of relatedNpcBonds(npcId)) {
        adjustNpcFavor(relatedId, amount * fraction, `spillover_${npcId}`, true);
      }
    }
  }

  function _resolveTokens(text, npcRec, _depth = 0) {
    if (!text) return '';
    const p     = deps.getPlayerData();
    const name  = p?.nickname || 'Farmer';
    const gen   = p?.appearance?.gender || 'male';
    const pr1   = gen === 'female' ? 'she'     : gen === 'neutral' ? 'they'    : 'he';
    const pr2   = gen === 'female' ? 'her'     : gen === 'neutral' ? 'them'    : 'him';
    const pr3   = gen === 'female' ? 'her'     : gen === 'neutral' ? 'their'   : 'his';
    const prS   = gen === 'female' ? 'herself' : gen === 'neutral' ? 'themself': 'himself';
    const VOWELS = new Set('aeiouAEIOU');
    let fl2v1 = '';
    for (const ch of name) { fl2v1 += ch; if (VOWELS.has(ch)) break; }
    const st    = getNpcDlgState(npcRec?.id);
    const local = st.localNickname || name;
    let out = text
      .replace(/\{\{npcName\}\}/g,            npcRec?.name || '')
      .replace(/\{\{playerName\}\}/g,          name)
      .replace(/\{\{playerNickname\}\}/g,      name)
      .replace(/\{\{playerLocalNickname\}\}/g, local)
      .replace(/\{\{playerPronoun1\}\}/g,      pr1)
      .replace(/\{\{playerPronoun2\}\}/g,      pr2)
      .replace(/\{\{playerPronoun3\}\}/g,      pr3)
      .replace(/\{\{playerPronounSelf\}\}/g,   prS)
      .replace(/\{\{playerFirstL2V1\}\}/g,     fl2v1)
      .replace(/\{\{role\}\}/g,                npcRec?.role || '')
      .replace(/\{\{npcSpecies\}\}/g,           npcRec?.appearance?.speciesId || npcRec?.species || '')
      .replace(/\{\{playerSpecies\}\}/g,        p?.appearance?.speciesId || '');
    // {{pool:<id>}} pulls a conditioned line from a phrase pool authored
    // in the dialogue editor's Phrase Pool Manager — resolved recursively
    // (a pool entry can itself use any token, including another pool),
    // capped at a few levels deep so an accidental pool-references-itself
    // loop can't hang the game.
    if (_depth < 4) {
      out = out.replace(/\{\{pool:([^}]+)\}\}/g, (m, poolId) => {
        const entry = _pickPoolEntry(poolId.trim(), npcRec);
        return entry ? _resolveTokens(entry.text, npcRec, _depth + 1) : '';
      });
    }
    return out;
  }

  // A tree's (or phrase-pool entry's) conditions/excludeConditions are
  // authored in the dialogue editor (docs/tools/dialogue-editor/) as
  // { weekdays, seasons, weather, timesOfDay, encounter, maps, stations,
  // playerSpecies, relationship:{min,max} } — empty arrays/null bounds
  // mean "unrestricted" on that axis. "maps" matches currentArea
  // directly (editor's map ids — 'farm', 'town', 'map_i_general_store',
  // etc — are the same strings the world engine already uses).
  // "stations" matches the walker's current schedule-target label,
  // normalized the same way the existing General Store/Carpenter
  // on-duty checks do (see normalizeStationLabel). The axis list,
  // eligibility/specificity evaluation, and "most-specific-unheard-wins"
  // selection all live in the shared docs/js/condition-registry.js
  // module (window.ConditionRegistry) — also consumed by the Loot &
  // Shop system and its dev tool, so this is a thin wrapper that just
  // supplies dialogue's own world-state shape.

  // World state is shared by both tree selection and phrase-pool entry
  // resolution — "encounter" (first vs returning) is keyed off whichever
  // NPC state is passed in, so a pool entry picked mid-conversation with
  // a different NPC than the tree's still reads that NPC's own history.
  function _dlgWorldState(rec) {
    const st = getNpcDlgState(rec?.id);
    const target = deps.getDialogueWalker()?.currentScheduleTarget || null;
    return {
      weekdays:   deps.currentWeekdayName(),
      seasons:    deps.currentSeason().name,
      weather:    deps.calendar.weather,
      timesOfDay: deps.fishingTimeOfDay(),
      encounter:  (st.heardTrees || []).length ? 'returning' : 'first',
      maps:       deps.getCurrentArea(),
      stations:   target ? deps.normalizeStationLabel(target.label) : '',
      playerSpecies: deps.getPlayerData()?.appearance?.speciesId || '',
      relationship: st.favor,
    };
  }

  function _dlgEntryEligible(entry, world) {
    return window.ConditionRegistry.entryEligible(entry, world);
  }

  function _dlgEntrySpecificity(entry) {
    return window.ConditionRegistry.entrySpecificity(entry);
  }

  // Shared by dialogue-tree selection and phrase-pool entry resolution:
  // among entries whose conditions are met (and no-fly conditions
  // aren't), the most specifically-targeted one that has never been
  // heard before always wins — so a well-conditioned entry for "today"
  // plays before anything generic. Once every entry that matches the
  // exact current combination has been heard at least once, selection
  // among the remaining eligible entries is randomized instead of
  // repeating the same priority order every time. `entries` is any list
  // of { id, conditions, excludeConditions, priority? }; `heard` is the
  // array of already-heard ids to check/rank against.
  function _pickBestEntry(entries, world, heard) {
    return window.ConditionRegistry.pickBestEntry(entries, world, heard);
  }

  function _pickDialogueTree(rec) {
    // A tree can tag itself visibility: 'owner' or 'farmhand' to restrict
    // it to the world's protagonist or to non-owner members respectively;
    // omitted/'any' (the default) is visible to everyone.
    const all = (rec?.dialogueTrees || [])
      .filter(t => (t.trigger || 'interact') === 'interact' && deps.canAccessContent(t.visibility));
    if (!all.length) return null;
    const world = _dlgWorldState(rec);
    const heard = getNpcDlgState(rec?.id).heardTrees || [];
    return _pickBestEntry(all, world, heard);
  }

  function _markDialogueTreeHeard(rec, tree) {
    if (!rec || !tree) return;
    const st = getNpcDlgState(rec.id);
    if (!st.heardTrees.includes(tree.id)) st.heardTrees.push(tree.id);
  }

  // Resolves one {{pool:<id>}} reference against this NPC's own
  // phrasePools (pools are per-NPC, authored in the dialogue editor's
  // Phrase Pool Manager), tracking which entries have been heard the
  // same way dialogue trees are (see _markDialogueTreeHeard) so a pool
  // cycles through its unheard entries before repeating.
  function _pickPoolEntry(poolId, rec) {
    const pool = (rec?.phrasePools || []).find(p => p.id === poolId || p.name === poolId);
    if (!pool || !pool.entries?.length) return null;
    const world = _dlgWorldState(rec);
    const st    = getNpcDlgState(rec?.id);
    const entry = _pickBestEntry(pool.entries, world, st.heardPoolEntries || []);
    if (entry && !st.heardPoolEntries.includes(entry.id)) st.heardPoolEntries.push(entry.id);
    return entry;
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
        if (!deps.getDialogueOpen()) return;
        let skipNav = false;
        (c.actions || []).forEach(act => {
          if (act.type === 'setLocalNickname') {
            const st = getNpcDlgState(_dlgNpcRec?.id);
            st.localNickname = _resolveTokens(act.value || '', _dlgNpcRec) || null;
          } else if (act.type === 'adjustRapport') {
            const amount = Number(act.amount); // Used to keep dialogue-authored positive/negative Rapport changes numeric and reject malformed values.
            if (Number.isFinite(amount) && amount !== 0) {
              window.NpcRapport?.adjust?.(_dlgNpcRec?.id, amount, `dialogue_choice:${_dlgTree?.id || 'synthetic'}:${node.id || i}`);
            }
          } else if (act.type === 'openShop') {
            // `pool` names a WARES_POOLS entry; omitted defaults to the
            // General Store for backward compatibility with any tree
            // authored before pools existed (bare {type:'openShop'}).
            const pool = deps.getWaresPools()[act.pool || 'generalStoreWares'];
            if (pool) { deps.closeNpcDialogue(); deps.openMenu(pool.menuId); }
            skipNav = true;
          } else if (act.type === 'openCraftMenu') {
            // Sloomi/Kzubug's smithing counter — craft/plate/reinforce
            // verdigris tools from dug-up metal bars (see
            // renderMetalCraftShopPage). Both smiths offer the identical
            // service, so there's no per-NPC pool indirection needed.
            deps.closeNpcDialogue(); deps.openMenu('metalCraftShop');
            skipNav = true;
          } else if (act.type === 'startChat') {
            _beginNpcConversation(_dlgNpcRec);
            skipNav = true;
          } else if (act.type === 'acceptFavor') {
            deps.setQuestStatus(act.taskId, 'available', {});
            deps.showToast('📋 Favor accepted — check it from the Tasks tab.', true);
          } else if (act.type === 'declineFavor') {
            deps.setQuestStatus(act.taskId, 'declined', {});
          } else if (act.type === 'acceptRequest') {
            const res = window.ProceduralTasks.acceptRequest(act.taskId);
            if (!res.ok) {
              deps.showToast(res.message, false);
            } else {
              const acceptanceLine = window.ProceduralTasks.requestAcceptanceLine?.(act.taskId);
              if (acceptanceLine) {
                renderDlgNode({ type: 'line', text: acceptanceLine });
                skipNav = true;
              }
            }
          } else if (act.type === 'declineRequest') {
            window.ProceduralTasks.declineRequest(act.taskId);
          } else if (act.type === 'turnInTask') {
            const res = deps.turnInTask(act.taskId);
            if (!res.ok) deps.showToast(res.message, false);
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

  function hideChoiceButtons() {
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

  function dialogueSeatId(walker = deps.getDialogueWalker()) {
    return walker?.rec?.id || walker?.rec?.name || 'npcDialogue';
  }

  function _npcRestingExpression(rec = _dlgNpcRec || deps.getDialogueWalker()?.rec) {
    const cfg = window.SCRATCHBONES_CONFIG?.game?.portrait?.expressions || {};
    const fallback = String(cfg.defaultResting || 'neutral').toLowerCase();
    const available = Array.isArray(cfg.available) ? cfg.available.map(value => String(value).toLowerCase()) : [];
    const authored = String(rec?.restingExpression || fallback).toLowerCase();
    return !available.length || available.includes(authored) ? authored : fallback;
  }

  function _playNpcDialogueLetterSfx(char, rec = _dlgNpcRec || deps.getDialogueWalker()?.rec) {
    const cfg = npcDialogueLetterSfxConfig(rec);
    if (cfg.enabled === false || !char || /\s/.test(char)) return;
    const audioCfg = window.AudioSystem?.gameAudioConfig();
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

  function stopNpcDialogueTypewriter(showFullText = false) {
    _npcDialogueSequenceId++;
    for (const timer of _npcDialogueTypeTimers) clearTimeout(timer);
    _npcDialogueTypeTimers = [];
    if (showFullText && _npcDialogueTypeText) _npcDialogueTextEl.textContent = _npcDialogueTypeText;
    _npcDialogueTypeText = '';
    _npcDialogueTypeIndex = 0;
    _npcDialogueTypeUnits = [];
  }

  // World of Warcraft's drunken speech filter is deliberately simple: every
  // S/s gains a lowercase h, then " ...hic!" is appended. Apply it only to
  // the final resolved NPC line so authored text stays pristine and inserted
  // tokens/phrase-pool output are slurred exactly like the surrounding words.
  function _wowDrunkifyNpcSpeech(text, rec = _dlgNpcRec || deps?.getDialogueWalker?.()?.rec) {
    const source = String(text || ''); // Used as the unchanged sober line and as the input to WoW's text transform.
    const npcId = rec?.id; // Used to query the existing NPC alcohol state instead of introducing a second drunkenness model.
    const drunkFraction = npcId ? (Number(window.HobunjiDrunkGameplayBridge?.npcDrunkFraction?.(npcId)) || 0) : 0; // Used only to gate the visual speech filter.
    if (!(drunkFraction > 0)) return source;
    return source.replace(/[Ss]/g, '$&h') + ' ...hic!';
  }

  function _setNpcDialogueText(text, node = null) {
    const resolvedText = _wowDrunkifyNpcSpeech(text);
    stopNpcDialogueTypewriter(false);
    _applyNpcDialogueLinePresentation(resolvedText, node);
    const cfg = npcDialogueTypewriterConfig();
    if (!cfg.enabled) {
      _npcDialogueTextEl.textContent = resolvedText;
      window.portraitBreathingComposer?.scheduleYapSequence(
        dialogueSeatId(), resolvedText, npcDialoguePortraitConfig().yap || {}
      );
      return;
    }
    _npcDialogueTypeText = resolvedText;
    _npcDialogueTypeIndex = 0;
    _npcDialogueTypeUnits = window.DialogueSpeechCadence?.buildSchedule(resolvedText, cfg)
      || [...resolvedText].map((char, index) => ({ text: char, vowel: /[aeiou]/i.test(char) ? char : null, vowels: /[aeiou]/i.test(char) ? [char] : [], revealAtMs: index * 50 + 50, pulseOffsetsMs: [0] }));
    _npcDialogueTextEl.textContent = '';
    const sequenceId = _npcDialogueSequenceId;
    for (const unit of _npcDialogueTypeUnits) {
      _npcDialogueTypeTimers.push(setTimeout(() => {
        if (sequenceId !== _npcDialogueSequenceId || !deps.getDialogueOpen()) return;
        _npcDialogueTextEl.textContent += unit.text;
        _npcDialogueTypeIndex++;
      }, unit.revealAtMs));
      for (let index = 0; index < unit.vowels.length; index++) {
        const pulseAtMs = unit.revealAtMs + (unit.pulseOffsetsMs[index] || 0);
        _npcDialogueTypeTimers.push(setTimeout(() => {
          if (sequenceId !== _npcDialogueSequenceId || !deps.getDialogueOpen()) return;
          _playNpcDialogueLetterSfx(unit.vowels[index]);
          window.portraitBreathingComposer?.triggerYap(
            dialogueSeatId(), npcDialoguePortraitConfig().yap || {}
          );
        }, pulseAtMs));
      }
    }
    const finalUnit = _npcDialogueTypeUnits[_npcDialogueTypeUnits.length - 1];
    const finalPulseOffset = Math.max(0, ...(finalUnit?.pulseOffsetsMs || [0]));
    const completeAtMs = (finalUnit?.revealAtMs || 0) + finalPulseOffset + 1;
    _npcDialogueTypeTimers.push(setTimeout(() => {
      if (sequenceId !== _npcDialogueSequenceId) return;
      _npcDialogueTypeText = '';
      _npcDialogueTypeIndex = 0;
      _npcDialogueTypeUnits = [];
      _npcDialogueTypeTimers = [];
    }, completeAtMs));
  }

  function _applyNpcDialogueLinePresentation(text, node = null) {
    if (!window.portraitBreathingComposer) return;
    const seatId = dialogueSeatId();
    window.portraitBreathingComposer.setDefaultExpression(seatId, _npcRestingExpression());
    if (node && Object.hasOwn(node, 'expression') && node.expression) {
      const expression = String(node.expression).toLowerCase();
      window.portraitBreathingComposer.setExpression(seatId, expression, _dialogueExpressionDurationMs(node));
    } else {
      window.portraitBreathingComposer.clearExpression(seatId);
    }
  }

  async function _renderNpcDialoguePortrait() {
    const walker = deps.getDialogueWalker();
    if (!deps.getDialogueOpen() || !walker?.profile || !window.NpcAvatarPreview) return false;
    const renderOptions = {
      breathingComposer: window.portraitBreathingComposer || null,
      seatId: dialogueSeatId(),
    };
    await window.NpcAvatarPreview.renderProfileToCanvas(_npcPortraitCanvas, walker.profile, renderOptions);
    if (walker.avatarFrontCanvas && window.PNGPlaneAvatar?.refreshSinglePlaneAvatarModel) {
      await window.NpcAvatarPreview.renderProfileToCanvas(walker.avatarFrontCanvas, walker.profile, renderOptions);
      window.PNGPlaneAvatar.refreshSinglePlaneAvatarModel(walker.avatarGroup, walker.avatarFrontCanvas);
    }
    return true;
  }

  let _npcDialoguePortraitRenderPending = false;
  let _npcDialoguePortraitLastRenderMs = 0;
  function updateNpcDialoguePortrait(nowMs = performance.now()) {
    if (!deps.getDialogueOpen() || !deps.getDialogueWalker()?.profile || _npcDialoguePortraitRenderPending) return;
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

  function renderDlgNode(node) {
    if (!node) { deps.closeNpcDialogue(); return; }
    _dlgNode = node;

    if (node.type === 'end') { deps.closeNpcDialogue(); return; }

    if (node.type === 'sequence') { _handleSequenceNode(node); return; }

    const text = _resolveTokens(node.text || '', _dlgNpcRec);
    _setNpcDialogueText(text, node);
    updateNpcDialoguePortrait(0);

    if (node.type === 'choice') {
      _showDlgChoices(node);
    } else {
      hideChoiceButtons();
    }
  }

  function _handleSequenceNode(seqNode) {
    const st       = getNpcDlgState(_dlgNpcRec?.id);
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
        deps.closeNpcDialogue();
      }
      return;
    }
    const node = _dlgNodeMap?.[nodeId];
    if (!node) { deps.closeNpcDialogue(); return; }
    renderDlgNode(node);
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
  // of the merchant shop/chat choice in game.js's openNpcDialogue.
  function _beginNpcConversation(rec) {
    const tree = _pickDialogueTree(rec);
    if (tree) {
      _markDialogueTreeHeard(rec, tree);
      _dlgTree    = tree;
      _dlgNodeMap = Object.fromEntries((tree.nodes || []).map(n => [n.id, n]));
      _dlgNpcRec  = rec;
      _dlgSeqStack = [];
      _dialogueLines   = [];
      _dialogueLineIdx = 0;
      _navigateDlgTo(tree.entryNode);
    } else {
      _dlgTree = null; _dlgNodeMap = null; _dlgNode = null; _dlgNpcRec = rec;
      hideChoiceButtons();
      _dialogueLines   = _npcDialogueLines(rec);
      _dialogueLineIdx = 0;
      _setNpcDialogueText(_dialogueLines[0]);
      updateNpcDialoguePortrait(0);
    }
  }

  function advanceNpcDialogue() {
    if (_npcDialogueTypeText) { stopNpcDialogueTypewriter(true); return; }
    // Cutscene Preview drives its own talk/choice stage sequence instead
    // of an authored dialogueTree — see game.js's "Cutscene Preview Mode".
    if (deps.getCutscenePreviewActive()) { deps.getCutscenePreviewAdvance()?.(); return; }
    if (_dlgTree) { _advanceDlgNode(); return; }
    _dialogueLineIdx++;
    if (_dialogueLineIdx >= _dialogueLines.length) { deps.closeNpcDialogue(); return; }
    _setNpcDialogueText(_dialogueLines[_dialogueLineIdx]);
    updateNpcDialoguePortrait(0);
  }

  function renderRelationshipHearts(rec) {
    if (!rec?.relationship) return '';
    const score = getNpcDlgState(rec.id).favor || 0;
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

  // Clears the active conversation's flow state — called by game.js's
  // closeNpcDialogue (which owns ending a conversation, including the
  // camera/staging teardown this module doesn't touch).
  function resetDialogueState() {
    _dialogueLines = [];
    _dialogueLineIdx = 0;
    _dlgTree = null; _dlgNodeMap = null; _dlgNode = null; _dlgNpcRec = null; _dlgSeqStack = [];
  }

  // Primes flow state for one of game.js's synthetic pre-choice screens
  // (task turn-in / favor ask / shop-counter fast-path) — those screens
  // bypass the NPC's authored dialogue tree entirely, so this just points
  // _dlgNpcRec at the right NPC (for token resolution) and clears any
  // leftover tree/sequence state before renderDlgNode renders the
  // synthetic choice node itself.
  function beginSyntheticChoice(rec) {
    _dlgNpcRec = rec; _dlgTree = null; _dlgNodeMap = null; _dlgSeqStack = [];
  }

  window.DialogueContent = {
    init,
    beginNpcConversation: _beginNpcConversation,
    renderDlgNode,
    renderRelationshipHearts,
    advanceNpcDialogue,
    updateNpcDialoguePortrait,
    loadNpcRelationships,
    npcRelationshipsSnapshot,
    npcFavorRescaleApplied: () => _favorRescaleApplied,
    recordNpcMemory,
    adjustNpcFavor,
    stopNpcDialogueTypewriter,
    hideChoiceButtons,
    dialogueSeatId,
    npcRestingExpression: _npcRestingExpression,
    getNpcDlgState,
    resetDialogueState,
    beginSyntheticChoice,
    renderNpcDialoguePortrait: _renderNpcDialoguePortrait,
    // Also used directly by game.js's Cutscene Preview Mode, which reuses
    // this module's dialogue-box/choice-button rendering for its own
    // scripted talk/choice stages instead of an authored dialogueTree.
    setNpcDialogueText: _setNpcDialogueText,
    wowDrunkifyNpcSpeech: _wowDrunkifyNpcSpeech,
    fitDlgOptionLabel: _fitDlgOptionLabel,
    playSpeechTick: _playNpcDialogueLetterSfx,
    npcDlgState: _npcDlgState,
    npcBaseDispositions: _npcBaseDispositions,
  };
})();