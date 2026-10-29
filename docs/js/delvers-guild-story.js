// Delver's Guild story: Garanki's invitation, licensed ruin access, and secret enchanting.
// World-scoped progression lives alongside OpeningStoryCutscene; accepted key quest lives in questProgress.
(() => {
  'use strict';

  const INVITATION_KEY = 'garanki_delvers_invitation'; // Shared doorstep completion key for Garanki's invitation.
  const INVITATION_DELAY_HOURS = 24; // In-game hours after Jubmir's Great Fey conversation.
  const TENT_MAP = 'map_i_researchers_tent'; // Authored room shared by both private conversations.
  const QUEST_ID = 'delvers_three_key_stones'; // Stable key used by the normal Tasks / Quest Log pane.
  const KEY_STONES = Object.freeze([
    { id: 'azgarlu_key_stone', name: 'Azgarlu of the Flame', label: "Azgarlu's Key-Stone" },
    { id: 'nanahi_key_stone', name: 'Nanahi the Unsleeping', label: "Nanahi's Key-Stone" },
    { id: 'imlao_key_stone', name: 'Imlao the Sightless', label: "Imlao's Key-Stone" },
  ]); // Quest items have definitions, but intentionally no loot, spawn or boss sources.
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
      ...KEY_STONES.map(key => ({ key: key.id, label: key.label, icon: '🗝️', desc: 'One of three ancient stone keys entombed with a powerful early-Harlyao mage. No known source has been discovered.', important: true })),
    ]; // Used by inventory definitions only; no automatic grants for the three ancient keys.
    for (const item of items) {
      defs[item.key] = { icon: item.icon, label: item.label, desc: item.desc, cat: 'material', tags: ['Harlyao', 'Quest'], sellPrice: 0, quest: true, important: true };
      if (!catalog.some(entry => entry.key === item.key)) catalog.push({ key: item.key, label: item.label.toUpperCase(), icon: item.icon, max: 1 });
    }
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
  function syncQuest() {
    if (!canEnchant()) return null;
    const store = questStore();
    if (!store) return null;
    const count = KEY_STONES.filter(key => (Number(inventoryDeps?.inventory?.[key.id]) || 0) > 0).length; // Counts only actually owned quest keys.
    const remaining = KEY_STONES.filter(key => !(Number(inventoryDeps?.inventory?.[key.id]) > 0)).map(key => key.name); // Used in the task's current objective.
    const objective = remaining.length ? 'Find, defeat and retrieve the key-stones of ' + remaining.join(', ') + '.' : 'All three key-stones recovered. Return to Garanki Gabu.';
    const detail = count + '/3 key-stones. They belonged to early-Harlyao mages; their graves are unknown and no loot sources have been assigned yet.';
    const old = store[QUEST_ID];
    if (old?.status === 'complete') return old; // A future hand-in implementation owns completion, not the absence of sources.
    if (old?.status === 'active' && old.progress?.objective === objective && old.progress?.detail === detail) return old;
    store[QUEST_ID] = {
      status: 'active',
      progress: { kind: 'story', provider: 'delversGuild', icon: '🗝️', title: 'The Three Key-Stones', npcName: 'Garanki Gabu', objective, detail, ready: count === 3 },
    };
    if (profile()) profile().questProgress = store; // Matches the current character's serialized quest mirror.
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
  }

  const api = Object.freeze({
    INVITATION_KEY, QUEST_ID, KEY_STONES, hasStone, isMember, canEnchant,
    bindInventoryDeps, bindQuestDeps, registerItems, restoreMembershipItem, syncQuest,
    invitationReady, nextInvitation, onInvitationComplete, dialogueTree, onDialogueNode,
    introScene, trustScene, playIntro: () => run('intro'), playTrust: () => run('trust'),
    debugSnapshot: () => ({
      ...progress, worldId: profile()?.worldId || null, hoursNow: clockHours(),
      invited: !!story().invited, member: isMember(), trusted: canEnchant(),
      hoursAfterJubmir: opening()?.getStory?.(profile())?.jubmirFeyCompletedAtHours ?? null,
      physicalStoneCount: Number(inventoryDeps?.inventory?.delversStone) || 0,
      artifactCount: window.ArtifactCollection?.value?.() || 0,
      quest: questStore()?.[QUEST_ID] || null,
    }),
  });
  window.DelversGuild = api;
  window.DoorstepVisits?.registerProvider({
    id: INVITATION_KEY, priority: 79,
    sync: invitationReady, next: nextInvitation, onComplete: onInvitationComplete,
  });
  document.addEventListener('hobunjiPlayerReady', () => {
    window.setTimeout(() => { restoreMembershipItem(); syncQuest(); }, 0); // Rehydrates inventory/quest after the normal member save has loaded.
  });
  window.DevCompanion?.registerStateProvider?.('delversGuild', () => api.debugSnapshot());
})();
