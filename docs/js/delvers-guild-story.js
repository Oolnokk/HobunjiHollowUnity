// Delver's Guild story: Garanki's invitation, licensed ruin access, and secret enchanting.
// World-scoped progression lives alongside OpeningStoryCutscene; accepted key quest lives in questProgress.
(() => {
  'use strict';

  const INVITATION_KEY = 'garanki_delvers_invitation'; // Shared doorstep completion key for Garanki's invitation.
  const INVITATION_DELAY_HOURS = 24; // In-game hours after Jubmir's Great Fey conversation.
  const TENT_MAP = 'map_i_researchers_tent'; // Authored room shared by both private conversations.
  const QUEST_ID = 'delvers_three_key_stones'; // Stable key used by the normal Tasks / Quest Log pane.
  const TALISMAN_KEY = 'harlyaoKeyTalisman'; // Combined story key: granted by Garanki, consumed when he takes it back after the investigation.
  const VAULT_ZONE = 'map_western_slope'; // Only the Western Slope hosts the moving story vault burrow.
  const KEY_STONES = Object.freeze([
    { id: 'azgarlu_key_stone', name: 'Azgarlu of the Flame', label: "Azgarlu's Key-Stone" },
    { id: 'nanahi_key_stone', name: 'Nanahi the Unsleeping', label: "Nanahi's Key-Stone" },
    { id: 'imlao_key_stone', name: 'Imlao the Sightless', label: "Imlao's Key-Stone" },
  ]); // Quest items are now carried by their named Harlyao lich guardians.
  const progress = { running: false, phase: 'idle', lastError: null, lastChange: "Garanki's two tent scenes, membership stone, licensed ruin doors, and unseeded Three Key-Stones quest." }; // Mobile-friendly status.
  let inventoryDeps = null; // ArtifactCollection's existing inventory/save adapter, reused for item grants.
  let questDeps = null; // TasksPanel's live getQuestProgress adapter, reused instead of a second quest store.

  function profile() { return window.__hobunjiPlayerProfile || null; }
  function opening() { return window.OpeningStoryCutscene; }
  function story() { return opening()?.getStory?.(profile())?.delversGuild || {}; }
  function setStory(patch) {
    if (!profile()?.worldId || !opening()?.updateStory) return false;
    return opening().updateStory(profile(), { delversGuild: { ...story(), ...patch } });
  }
  function clockHours() {
    const cal = window.CalendarSystem; // Same authoritative world clock that schedules Jubmir's visit.
    if (!cal?.isInitialized?.()) return null;
    const now = cal.previewAfterHours(0);
    const hours = (Number(now.day) - 1) * 24 + Number(cal.getHour(now.time01));
    return Number.isFinite(hours) ? hours : null;
  }
  function isMember() { return story().member === true; }
  function hasStone() { return isMember() && (Number(inventoryDeps?.inventory?.delversStone) || 0) > 0; } // Both a live licensed membership and possession of its Stone are required at every ruin-entry gate.
  function canEnchant() { return isMember() && story().trusted === true; }

  function log(message, level = 'npc') {
    window.__farmLog?.('[delvers-guild] ' + message, level);
  }

  function registerItems() {
    const defs = inventoryDeps?.ITEM_DEFS;
    const catalog = inventoryDeps?.inventoryItems;
    if (!defs || !Array.isArray(catalog)) return false;
    const items = [
      { key: 'delversStone', label: "Delver's Stone", icon: '🔴', desc: "A stone-priest's enchanted Guild amulet. Unlocks sealed Harlyao ruins and detects uncatalogued magic. Its signal can be traced by the Guild.", important: true },
      { key: TALISMAN_KEY, label: 'Harlyao Key Talisman', icon: '🗝️', desc: 'The key-stones of Azgarlu, Nanahi and Imlao set together by Garanki. It pulses faster as its hidden vault draws near.', important: true },
      ...KEY_STONES.map(key => ({ key: key.id, label: key.label, icon: '🗝️', desc: 'One of three ancient stone keys recovered from a named Harlyao lich tomb.', important: true })),
    ]; // Used by inventory definitions only; no automatic grants for the three ancient keys.
    for (const item of items) {
      defs[item.key] = { icon: item.icon, label: item.label, desc: item.desc, cat: 'material', tags: ['Harlyao', 'Quest'], sellPrice: 0, quest: true, important: true };
      if (!catalog.some(entry => entry.key === item.key)) catalog.push({ key: item.key, label: item.label.toUpperCase(), icon: item.icon, max: 1 });
    }
    return true;
  }
  function restoreTalisman() {
    if (!inventoryDeps?.inventory || !isMember() || !['search','report'].includes(vaultPhase())) return false;
    registerItems();
    const inventory = inventoryDeps.inventory; // The story phase is world-scoped; the physical key is its member-inventory counterpart.
    if ((Number(inventory[TALISMAN_KEY]) || 0) >= 1) return true;
    inventory[TALISMAN_KEY] = 1; // Repairs interrupted handoffs and older/restored saves instead of permanently soft-locking the vault quest.
    for (const key of KEY_STONES) inventory[key.id] = 0; // The components must not become a second usable set after assembly.
    inventoryDeps.saveMemberWorldData?.();
    inventoryDeps.buildInventoryGrid?.();
    return true;
  }
  function restoreMembershipItem() {
    if (!isMember() || !inventoryDeps?.inventory) return false;
    registerItems();
    if ((Number(inventoryDeps.inventory.delversStone) || 0) >= 1) return true;
    inventoryDeps.inventory.delversStone = 1; // Restores a non-discardable licensed stone across older imports and load-order differences.
    inventoryDeps.saveMemberWorldData?.();
    inventoryDeps.buildInventoryGrid?.();
    return true;
  }
  function bindInventoryDeps(deps) {
    inventoryDeps = deps; // Used for physical Stone/Key-Stone definitions and canonical save calls.
    registerItems(); // Do not write the player's save while game.js may still be restoring their inventory.
  }
  function grantKeyStone(bossId) {
    if (vaultPhase() !== 'keys') return false; // Tomb guardians cannot duplicate the three consumed stones after assembly or completion.
    const stone = KEY_STONES.find(item => item.id === bossId || item.id === bossId + '_key_stone');
    if (!stone || !inventoryDeps?.inventory) return false;
    registerItems(); // The same catalog and definitions the normal Pack uses.
    if ((Number(inventoryDeps.inventory[stone.id]) || 0) >= 1) return false;
    inventoryDeps.inventory[stone.id] = 1; // A single physical quest key per lich, saved with ordinary inventory.
    inventoryDeps.saveMemberWorldData?.();
    inventoryDeps.buildInventoryGrid?.();
    syncQuest();
    window.TasksPanel?.render?.();
    inventoryDeps.showToast?.('Recovered ' + stone.label + '!', true);
    return true;
  }

  function bindQuestDeps(deps) {
    questDeps = deps; // Used to mutate the exact live questProgress object TasksPanel renders; TasksPanel.render/PlayerReady refresh the quest later.
  }
  function questStore() {
    const live = questDeps?.getQuestProgress?.();
    if (live && typeof live === 'object') return live;
    const p = profile();
    if (!p) return null;
    if (!p.questProgress || typeof p.questProgress !== 'object') p.questProgress = {};
    return p.questProgress;
  }
  function vaultPhase() { return String(story().vaultPhase || 'keys'); }
  function hasTalisman() { return (Number(inventoryDeps?.inventory?.[TALISMAN_KEY]) || 0) > 0; }
  function vaultSite() { return story().vaultSite || null; } // World-scoped location persists on reload and is replaced only by a new Tothal cycle.
  function saveVaultSite(site) {
    if (vaultPhase() !== 'search' && vaultPhase() !== 'report') return false;
    if (!site || site.zoneId !== VAULT_ZONE || !Number.isInteger(site.col) || !Number.isInteger(site.row) || !Number.isFinite(Number(site.cycle))) return false;
    return setStory({ vaultSite: { zoneId:VAULT_ZONE, col:site.col, row:site.row, cycle:Number(site.cycle), revealed:site.revealed === true } });
  }
  function uncoverVault() {
    if (!hasTalisman() || vaultPhase() !== 'search' || !vaultSite()) return false;
    return saveVaultSite({ ...vaultSite(), revealed:true });
  }
  function investigateVault() {
    if (!hasTalisman() || vaultPhase() !== 'search' || !vaultSite()?.revealed) return false;
    if (!setStory({ vaultPhase:'report' })) return false;
    syncQuest();
    window.TasksPanel?.render?.();
    return true;
  }
  function syncQuest() {
    if (!canEnchant()) return null;
    const store = questStore();
    if (!store) return null;
    const phase = vaultPhase(); // The original three-key objective remains intact on pre-vault saves.
    const count = KEY_STONES.filter(key => (Number(inventoryDeps?.inventory?.[key.id]) || 0) > 0).length;
    const remaining = KEY_STONES.filter(key => !(Number(inventoryDeps?.inventory?.[key.id]) > 0)).map(key => key.name);
    const objective = phase === 'search'
      ? 'Search the Western Slope. Follow the Harlyao Key Talisman\'s increasingly frequent pulses to the buried vault.'
      : phase === 'report'
        ? 'Return to Garanki Gabu and explain what you found in the empty vault.'
        : phase === 'complete'
          ? 'Garanki has taken the talisman to investigate the empty vault himself. Await his word.'
          : remaining.length
            ? 'Find, defeat and retrieve the key-stones of ' + remaining.join(', ') + '.'
            : 'All three key-stones recovered. Return to Garanki Gabu.';
    const detail = phase === 'keys'
      ? count + '/3 key-stones. Azgarlu guards a Hronal ruin, Nanahi a Tothal ruin, and Imlao a Kanthic ruin.'
      : phase === 'search'
        ? 'The vault is a concealed, diggable burrow in the Western Slope. Its location can shift with Tothal, but the quest is never lost.'
        : phase === 'report'
          ? 'The great door was smashed; black bird-like footprints lead to an empty pedestal and back.'
          : 'Garanki will investigate the mysterious intruder and send for you when he has news.';
    const old = store[QUEST_ID];
    const status = phase === 'complete' ? 'complete' : 'active';
    if (old?.status === status && old.progress?.objective === objective && old.progress?.detail === detail) return old;
    store[QUEST_ID] = {
      status,
      progress: { kind:'story', provider:'delversGuild', icon:'🗝️', title:'The Three Key-Stones', npcName:'Garanki Gabu', objective, detail, ready:phase === 'keys' && count === 3 },
    };
    if (profile()) profile().questProgress = store;
    inventoryDeps?.saveMemberWorldData?.();
    return store[QUEST_ID];
  }

  function invitationReady() {
    const p = profile();
    if (p?.isWorldOwner !== true || !opening()?.getStory) return false;
    const source = opening().getStory(p);
    if (!source?.jubmirFeyComplete || story().invited || isMember()) return false;
    const now = clockHours();
    if (now === null) return false;
    const completedAt = Number(source.jubmirFeyCompletedAtHours);
    if (source.jubmirFeyCompletedAtHours !== null && source.jubmirFeyCompletedAtHours !== undefined && Number.isFinite(completedAt)) {
      return now >= completedAt + INVITATION_DELAY_HOURS;
    }
    // Legacy saves do not know when Jubmir spoke: begin a one-time countdown, never backdate it.
    if (!Number.isFinite(story().legacyJubmirObservedAtHours)) setStory({ legacyJubmirObservedAtHours: now });
    return now >= Number(story().legacyJubmirObservedAtHours) + INVITATION_DELAY_HOURS;
  }
  function nextInvitation() {
    if (!invitationReady() || progress.running) return null;
    return {
      key: INVITATION_KEY, npcId: 'garanki_gabu',
      tree: {
        id: 'delvers_garanki_doorstep', label: "Garanki's Invitation", entryNode: 'invite',
        nodes: [{
          id: 'invite', type: 'text',
          text: "Good {{timeOfDay}}. Garanki Gabu — researcher and professor, at your service. I've heard you're trying to make Hobunji Hollow safer and more prosperous. I believe I can help you with both. Come visit me at my camp when you have the time; we should talk privately inside my tent.",
          next: null,
        }],
      },
    };
  }
  function onInvitationComplete() {
    if (!invitationReady()) return !!story().invited;
    if (!setStory({ invited: true })) return false; // Keep the visitor pending if portable save persistence failed.
    log("Garanki invited the player to his camp.");
    return true;
  }

  function talk(id, text) {
    return {
      id, type: 'talk', speakerId: 'garanki', addressedActorId: 'player', text, next: '__next__',
      cameraMode: 'orbit', orbitActorIds: ['player', 'garanki'], orbitAlternateFocus: true,
      orbitInitialZoomPercent: 115, orbitZoomStepPercent: 5, orbitDistanceTiles: 1.8,
      orbitSpeedDegPerSec: 6, orbitInstantCut: true, orbitHeightMode: 'oppositeFaceArc',
      horizontalCameraCollision: true,
    }; // Uses the established two-person authored cutscene camera instead of a new rig.
  }
  function scene(garankiRecord, title, stages) {
    return {
      version: 6, title, mapId: TENT_MAP,
      actors: [
        { id: 'player', name: profile()?.nickname || 'Farmer', isPlayer: true, worldC: 4, worldR: 4, rotation: 90, pose: 'standing' },
        { id: 'garanki', name: 'Garanki Gabu', npcId: 'garanki_gabu', npcRecord: garankiRecord, worldC: 5, worldR: 4, rotation: 270, pose: 'standing' },
      ],
      stages: [{ id: 'guild_fade_in', type: 'fade', direction: 'in', duration: 0.6, next: '__next__' }, ...stages,
        { id: 'guild_fade_out', type: 'fade', direction: 'out', duration: 0.6, next: '__end__' }],
    };
  }
  function introScene(rec) {
    return scene(rec, "Garanki Gabu — The Delver's Guild", [
      talk('guild_intro_0', "Jubmir tells me you're searching for the Great Fey to convince them to turn aside the Ghost Army. A worthy concern, even if the premise is mistaken."),
      talk('guild_intro_1', "Fey, you see, are not real. What people take for fey manifestations are illusions and mistakes of perception. Natural, mildly toxic gases and certain plants can produce quite extraordinary visions."),
      talk('guild_intro_2', "This isn't mere conjecture. At the Tower of Learning in Kumapirra, where I'm a professor, we've reproduced these effects under controlled conditions and tested the old claims at length."),
      talk('guild_intro_3', "But ghosts? The Harlyao Ghost Army? No. Those are neither superstition nor trickery. They pose a material danger to this village, and they'll require a material solution."),
      talk('guild_intro_4', "I am looking for something very specific that could help us resolve this. What it is, I cannot yet disclose. I need a reliable assistant, and you seem determined to prove yourself."),
      talk('guild_intro_5', "There are rewards beyond the good you'll do Hobunji Hollow. I also happen to be a high-ranking member of the Delver's Guild, founded by King Khanibarr to recover and regulate dangerous magic."),
      talk('guild_intro_6', "A licensed Delver receives a stone-priest-made Delver's Stone. It can unlock sealed Harlyao ruins without the old illegal practice of smashing their doors with Shattercasks."),
      talk('guild_intro_7', "It glows red and hums when you carry uncatalogued magical objects, and reports their location to the Guild. You must not discard one: take it to a Guild official for cataloguing. Harmless enough discoveries may be registered for you to keep and use legally; dangerous ones are purchased from you."),
      talk('guild_intro_8', "If a sensed artifact suddenly disappears at close range, stone priests investigate. They might find a discarded contraband, or a Delver murdered for their discovery. Your movements in possession of such an item are recorded."),
      talk('guild_intro_9', "And there's another service my studies have prepared me to offer, once you've earned my trust. Shall I enroll you as a Delver and give you your Stone?"),
      { id: 'guild_join_choice', type: 'choice', speakerId: 'player', addressedActorId: 'garanki', text: 'Join the Delver\'s Guild?', options: [
        { text: "Yes. I'll join the Guild.", next: 'guild_join_final' },
        { text: 'Not just yet.', next: 'guild_decline' },
      ] },
      { ...talk('guild_join_final', "Then welcome to the Guild. Carry this Stone with you, and come back to me with what you discover in the ruins. We'll both learn whether I can trust you with more."), next: 'guild_fade_out' },
      { ...talk('guild_decline', "Quite understandable. The offer will stand. Visit my tent if you change your mind."), next: 'guild_fade_out' },
    ]);
  }
  function trustScene(rec) {
    return scene(rec, 'Garanki Gabu — A Forbidden Art', [
      talk('trust_intro_0', "You've shown yourself to be diligent and discreet. I've learned a great deal from the relics you've brought me, and I've decided I can finally trust you with the truth of my other service."),
      talk('trust_intro_1', "At the Tower of Learning I studied how enchantments are made — not merely how to unbind or remove them, but how to put fresh magic into an object."),
      talk('trust_intro_2', "The act of enchanting a new item is highly illegal, even for a Delver of my rank. My connections can keep the Guild and the Crown from troubling us, so long as we don't attract too much attention."),
      talk('trust_intro_3', "Now that I trust you, I'll enchant your weapons with the rites I've learned from our recovered relics. Keep these dealings discreet. We're both taking a considerable risk."),
      talk('trust_intro_4', "As for what I've been searching for: it is sealed in a hidden vault. Finding it and opening it requires three special stone keys. Each was owned by a powerful mage of the early Harlyao era, and each was entombed with its owner."),
      talk('trust_intro_5', "There were so many mighty mages in that age that finding three particular graves among the ruins will be like looking for a needle in a haystack. But it must be done, and the exploration itself should reward you handsomely."),
      talk('trust_intro_6', "The three you seek are Azgarlu of the Flame, Nanahi the Unsleeping, and Imlao the Sightless. Defeat whatever remains of each and retrieve their key-stones."),
      { id: 'trust_question', type: 'choice', speakerId: 'player', addressedActorId: 'garanki', text: 'What do you ask Garanki?', options: [
        { text: "What exactly is locked in that vault?", next: 'trust_secret' },
        { text: "I'll find the three key-stones.", next: 'trust_final' },
      ] },
      { ...talk('trust_secret', "You'll know what we're looking for when the time comes. Not before. Even here, in private, I won't name it."), next: 'trust_final' },
      { ...talk('trust_final', "Bring me the key-stones of Azgarlu, Nanahi and Imlao. Until then, my enchanting services are yours — provided you keep quiet about their true nature."), next: 'guild_fade_out' },
    ]);
  }

  function playVaultInvestigation() {
    if (progress.running || vaultPhase() !== 'search' || !hasTalisman() || !vaultSite()?.revealed ||
        window.DevRandomRuin?.getState?.()?.ruinName !== 'Forgotten Harlyao Vault') return false;
    const camera = window.CinematicCameraRuntime; // Existing authored-camera override actually drives the game's normal camera renderer.
    if (!camera?.activate || !document?.body) return false;
    progress.running = true;
    progress.phase = 'vault-investigation';
    let stage = 0; // Two shots only: empty relic pedestal, then the black bird-like trail.
    const actionLock = window.CharacterActionLocks?.acquire?.({
      owner:'delvers-vault-investigation',
      reason:'Examining the emptied Harlyao vault',
      participants:[{id:'player',channels:['movement','tools','actions','camera']}],
    }) || null; // Real game input gating; the overlay alone does not block mobile combat and movement.
    document.exitPointerLock?.(); // Restore ordinary pointer behavior for the investigation's Continue button.
    const overlay = document.createElement('div'); // Accessible investigation dialogue after movement and combat are locked.
    overlay.id = 'delversVaultInvestigation';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99990;display:flex;align-items:flex-end;justify-content:center;padding:0 14px 7vh;background:rgba(0,0,0,.08);pointer-events:auto';
    const panel = document.createElement('div'); // Accessible mobile-readable dialogue in place of a console-only investigative toast.
    panel.style.cssText = 'box-sizing:border-box;width:min(95vw,580px);padding:16px 20px;border:1px solid #827c68;border-radius:12px;background:rgba(21,19,17,.93);color:#f4efe3;font:16px/1.5 serif;box-shadow:0 8px 24px #0009';
    const label = document.createElement('p');
    label.style.cssText = 'margin:0 0 16px';
    const button = document.createElement('button');
    button.type = 'button';
    button.style.cssText = 'display:block;margin-left:auto;border:1px solid #b1a58e;border-radius:8px;background:#443a2e;color:white;font:600 15px sans-serif;padding:10px 19px;min-height:44px';
    panel.append(label,button);overlay.append(panel);
    const shots = [
      { id:'empty_pedestal',position:{x:7.3,y:2.02,z:8.2},target:{x:6.5,y:.83,z:5.4},fovDeg:32,blendSeconds:.65,
        text:'The pedestal is empty. Someone has already been here — and taken whatever was hidden in the vault.' },
      { id:'bird_tracks',position:{x:6.25,y:1.16,z:9.25},target:{x:6.1,y:.03,z:8.3},fovDeg:25,blendSeconds:.75,
        text:'Black footprints run from the entrance, past the shattered door, to the pedestal and back. They look like the tracks of some sort of bird.' },
    ]; // Both cameras focus authored world coordinates shared with the fixed ruin/PNG projections.
    let closed = false; // Idempotent release guards double taps and simultaneous keyboard/controller activation.
    const close = (finished) => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown',onKey);
      overlay.remove();
      camera.deactivate();
      actionLock?.release?.();
      progress.running = false;
      progress.phase = finished ? 'vault-investigated' : 'vault-investigation-cancelled';
      if (finished && investigateVault()) {
        inventoryDeps?.showToast?.('Return to Garanki Gabu and explain what you saw.',true);
      }
    };
    const draw = () => {
      const shot = shots[stage];
      label.textContent = shot.text;
      button.textContent = stage === shots.length - 1 ? 'Finish investigation' : 'Continue';
      camera.activate('map_i_dev_random_ruin', {
        id:'story_vault_'+shot.id,
        label:'Forgotten Harlyao Vault — '+shot.id,
        position:shot.position,target:shot.target,fovDeg:shot.fovDeg,blendSeconds:shot.blendSeconds,
        stagePlayer:false,fadePets:true,horizontalCameraCollision:false,
      },{reason:'story-vault-investigation'});
      button.focus();
    };
    const advance = () => { if (++stage >= shots.length) close(true); else draw(); };
    const onKey = event => {
      if (event.key === 'Escape') {event.preventDefault();close(false);}
      else if (event.key === 'Enter' && event.target !== button) {event.preventDefault();advance();}
    }; // Controller/keyboard fallback uses the focused button's native Activate action.
    button.addEventListener('click',advance);
    document.addEventListener('keydown',onKey);
    document.body.appendChild(overlay);
    draw();
    return true;
  }

  function handoffScene(rec, kind) {
    return kind === 'assemble'
      ? scene(rec, 'Garanki Gabu — The Harlyao Key Talisman', [
          talk('talisman_0', "The three key-stones! You've found every one of them. Let me set them into their proper mount."),
          talk('talisman_1', "There. A Harlyao Key Talisman. Take it; it will pulse with light and sound when it draws near the vault."),
          talk('talisman_final', "Seek out the vault somewhere in the Western Slope. Follow the pulses, dig where the talisman leads you, and find what lies within."),
        ])
      : scene(rec, 'Garanki Gabu — The Empty Vault', [
          talk('vault_report_0', 'I was afraid of this.... but bird footprints you say?'),
          talk('vault_report_final', "Give me the amulet. I'll go investigate myself. I'll send word when I need of you next."),
        ]);
  }
  async function runHandoff(kind) {
    if (progress.running || !isMember() || !canEnchant()) return false;
    const isAssembly = kind === 'assemble';
    if (isAssembly ? vaultPhase() !== 'keys' || KEY_STONES.some(key => !(Number(inventoryDeps?.inventory?.[key.id]) > 0))
      : vaultPhase() !== 'report' || !hasTalisman()) return false;
    progress.running = true;
    progress.phase = kind;
    progress.lastError = null;
    try {
      const npc = await record();
      let accepted = false; // The physical inventory exchange happens only after the final cutscene dialogue is continued.
      if (!window.__hobunjiGameStarted || !window.AuthoredCutsceneRuntime?.run) throw new Error('Cutscene runtime not ready.');
      await window.AuthoredCutsceneRuntime.run(handoffScene(npc, kind), {
        onDialogueContinue(stage) { if (stage?.id === (isAssembly ? 'talisman_final' : 'vault_report_final')) accepted = true; },
      });
      if (!accepted) return false;
      if (!setStory({ vaultPhase:isAssembly ? 'search' : 'complete', ...(isAssembly ? {vaultSite:null} : {}) })) throw new Error('Could not save vault progress.');
      if (isAssembly) {
        for (const key of KEY_STONES) inventoryDeps.inventory[key.id] = 0;
        inventoryDeps.inventory[TALISMAN_KEY] = 1;
        inventoryDeps?.showToast?.('Received Harlyao Key Talisman — seek the vault in the Western Slope!', true);
      } else {
        inventoryDeps.inventory[TALISMAN_KEY] = 0;
        inventoryDeps?.showToast?.('The Harlyao Key Talisman was returned to Garanki.', true);
      }
      inventoryDeps?.saveMemberWorldData?.();
      inventoryDeps?.buildInventoryGrid?.();
      syncQuest();
      window.TasksPanel?.render?.();
      window.RuinSites?.syncMapMarkers?.();
      progress.phase = kind + '-complete';
      return true;
    } catch (error) {
      progress.lastError = error?.message || String(error);
      log('Vault handoff failed: ' + progress.lastError, 'warn');
      return false;
    } finally { progress.running = false; }
  }

  async function record() {
    const db = window.LocalDBOverrides
      ? await window.LocalDBOverrides.loadDatabase('npcDatabase')
      : await fetch('config/npcs/hobunji-starter-npc-database.json').then(response => {
          if (!response.ok) throw new Error('NPC database HTTP ' + response.status);
          return response.json();
        }); // Same authored NPC source as the opening cutscenes.
    const npc = db?.npcs?.find(entry => entry.id === 'garanki_gabu');
    if (!npc) throw new Error('Missing Garanki Gabu authored NPC record.');
    return npc;
  }
  async function run(kind) {
    if (progress.running || !story().invited) return false;
    if (kind === 'intro' && isMember()) return false;
    if (kind === 'trust' && (!isMember() || canEnchant() || !window.ArtifactCollection?.unlocked?.('base'))) return false;
    progress.running = true;
    progress.phase = kind;
    progress.lastError = null;
    try {
      if (!window.__hobunjiGameStarted || !window.AuthoredCutsceneRuntime?.run) throw new Error('Cutscene runtime not ready.');
      const npc = await record();
      let accepted = false; // Set only when Continue is pressed on the affirmative final scene beat.
      const lastId = kind === 'intro' ? 'guild_join_final' : 'trust_final';
      await window.AuthoredCutsceneRuntime.run(kind === 'intro' ? introScene(npc) : trustScene(npc), {
        onDialogueContinue(stage) { if (stage?.id === lastId) accepted = true; },
      });
      if (!accepted) { progress.phase = kind + '-interrupted'; return false; }
      if (kind === 'intro') {
        if (!setStory({ member: true })) throw new Error('Could not save Delver membership.');
        restoreMembershipItem();
        inventoryDeps?.showToast?.("Delver's Guild membership obtained — Delver's Stone received!", true);
      } else {
        if (!setStory({ trusted: true })) throw new Error('Could not save Garanki trust progress.');
        window.ArtifactCollection?.acknowledgeUnlocks?.();
        syncQuest();
        inventoryDeps?.showToast?.('Secret enchanting unlocked. Quest: The Three Key-Stones.', true);
      }
      window.TasksPanel?.render?.();
      progress.phase = kind + '-complete';
      log(kind + ' scene completed.');
      return true;
    } catch (error) {
      progress.lastError = error?.message || String(error);
      progress.phase = kind + '-error';
      log('Scene failed (retry available): ' + progress.lastError, 'warn');
      return false;
    } finally { progress.running = false; }
  }

  function dialogueTree() {
    if (!story().invited || progress.running) return null;
    const phase = vaultPhase(); // The hand-in and report must outrank the ordinary collection/store dialogue.
    if (phase === 'report' && hasTalisman()) return {
      id:'garanki_vault_report', trigger:'interact', priority:120, entryNode:'vault_report_choice', nodes:[
        { id:'vault_report_choice', type:'choice', speakerId:'player', addressedActorId:'garanki', text:'What do you tell Garanki?', options:[
          { text:'--explain what you saw--', next:'delvers_start_vault_report' },
          { text:'Not yet.', next:null },
        ] },
        { id:'delvers_start_vault_report', type:'end' },
      ],
    };
    if (phase === 'keys' && canEnchant() && KEY_STONES.every(key => (Number(inventoryDeps?.inventory?.[key.id]) || 0) > 0)) return {
      id:'garanki_talisman_handoff', trigger:'interact', priority:120, entryNode:'vault_assemble_choice', nodes:[
        { id:'vault_assemble_choice', type:'choice', speakerId:'player', addressedActorId:'garanki', text:'You have all three key-stones.', options:[
          { text:'Give Garanki the three key-stones.', next:'delvers_start_vault_assemble' },
          { text:'Keep them for now.', next:null },
        ] },
        { id:'delvers_start_vault_assemble', type:'end' },
      ],
    };
    const kind = !isMember() ? 'intro' : (!canEnchant() && window.ArtifactCollection?.unlocked?.('base') ? 'trust' : null);
    if (!kind) return null;
    const entry = kind === 'intro' ? 'delvers_meeting_prompt' : 'delvers_trust_prompt';
    const launch = kind === 'intro' ? 'delvers_start_intro' : 'delvers_start_trust';
    return { id: 'garanki_' + kind + '_meeting', trigger: 'interact', priority: 110, entryNode: entry, nodes: [
      { id: entry, type: 'text', text: kind === 'intro' ? "Ah, you came. Let's speak privately in the tent." : "I've been meaning to speak with you about the artifacts. There are things we must discuss in private.", next: launch },
      { id: launch, type: 'end' },
    ] }; // The end node closes normal dialogue before the authored cutscene takes control.
  }
  function onDialogueNode(node) {
    if (node?.type !== 'end') return;
    if (node.id === 'delvers_start_intro') window.setTimeout(() => { void run('intro'); }, 0);
    if (node.id === 'delvers_start_trust') window.setTimeout(() => { void run('trust'); }, 0);
    if (node.id === 'delvers_start_vault_assemble') window.setTimeout(() => { void runHandoff('assemble'); }, 0);
    if (node.id === 'delvers_start_vault_report') window.setTimeout(() => { void runHandoff('report'); }, 0);
  }

  const api = Object.freeze({
    INVITATION_KEY, QUEST_ID, KEY_STONES, TALISMAN_KEY, VAULT_ZONE, hasStone, isMember, canEnchant,
    vaultPhase, hasTalisman, vaultSite, saveVaultSite, uncoverVault, investigateVault, playVaultInvestigation, runHandoff,
    bindInventoryDeps, bindQuestDeps, registerItems, restoreMembershipItem, restoreTalisman, syncQuest, grantKeyStone,
    invitationReady, nextInvitation, onInvitationComplete, dialogueTree, onDialogueNode,
    introScene, trustScene, playIntro: () => run('intro'), playTrust: () => run('trust'),
    debugSnapshot: () => ({
      ...progress, worldId: profile()?.worldId || null, hoursNow: clockHours(),
      invited: !!story().invited, member: isMember(), trusted: canEnchant(),
      hoursAfterJubmir: opening()?.getStory?.(profile())?.jubmirFeyCompletedAtHours ?? null,
      physicalStoneCount: Number(inventoryDeps?.inventory?.delversStone) || 0,
      artifactCount: window.ArtifactCollection?.value?.() || 0,
      doorstep: { // Enables mobile diagnosis if a shifted-camp Garanki walker cannot be cloned to the farm.
        source: window.DoorstepVisits?.sourceDiagnostics?.('garanki_gabu') || null,
        registered: window.DoorstepVisits?.debugSnapshot?.()?.providers?.includes(INVITATION_KEY) === true,
      },
      quest: questStore()?.[QUEST_ID] || null,
      vault: { phase:vaultPhase(), site:vaultSite(), talisman:hasTalisman() },
    }),
  });
  window.DelversGuild = api;
  window.DoorstepVisits?.registerProvider({
    id: INVITATION_KEY, priority: 79,
    sync: invitationReady, next: nextInvitation, onComplete: onInvitationComplete,
  });
  document.addEventListener('hobunjiPlayerReady', () => {
    window.setTimeout(() => { restoreMembershipItem(); restoreTalisman(); syncQuest(); window.RuinSites?.refreshStoryVault?.(); }, 0); // Reloading directly into Western Slope rehydrates the burrow after the saved talisman becomes available.
  });
  window.DevCompanion?.registerStateProvider?.('delversGuild', () => api.debugSnapshot());
})();
