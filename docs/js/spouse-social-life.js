// Purposeful spouse conversations, shared outings and marriage-derived kinship.
// Event-time reads only: no world scan in the render loop and no shadow copies of buff state.
(() => {
  'use strict';
  if (window.SpouseSocialLife) return;

  const VOICES = Object.freeze({ // Used by selectAdvice to keep every eligible reminder in the spouse's own voice.
    tooth_hatayap: {
      kiss: "Hey, dumb-dumb. Come over here, I wanna kiss you.",
      rested: "Make it home safe tonight, {targetName}. And you can hold me extra close.",
      tired: "Make it home safe tonight, {targetName}. I'm dying to hold you close to me.",
      food: "Don't tell me you've been running around on an empty stomach, dumb-dumb. Eat something.",
      prayer: "It's Anan. Come on, {targetName}, let's go get our weekly blessing at the temple.",
      communion: "Spirit Communion's tonight. You're coming with me, dumb-dumb. It'll do us good.",
      festival: "There's a festival on. You're not leaving me to have all the fun by myself, {targetName}.",
      harvest: "Hey, dumb-dumb. There are {harvestCount} ripe crops nobody's assigned to pick. Get to it!",
      inn: "Come on, {targetName}. Let's go to the inn. I wanna show you off.",
      home: "Make it home safe tonight, {targetName}. I'm dying to hold you close to me."
    },
    aliri_ginju: {
      kiss: "Oh, {targetName}... could I have a kiss before you go?",
      rested: "You slept so well! I hope you have the loveliest day, {targetName}.",
      tired: "You look worn out, dear. Promise you'll come home for a proper night's rest?",
      food: "I think you'll feel much better after a good meal, {targetName}. Have you eaten?",
      prayer: "It's Anan, dear. Would you come to temple with me? We can renew our blessing.",
      communion: "Would you come to Spirit Communion with me tonight? I'd like to sit beside you.",
      festival: "There's a festival today! I thought we might go together, if you'd like.",
      harvest: "Oh! {harvestCount} crops are ready, but nobody's assigned to bring them in. Shall we see to them?",
      inn: "Would you like to visit the inn together after our chores, dear?",
      home: "I'll look after things here. I hope you come home safely, {targetName}."
    },
    nashka_khibu: {
      kiss: "Can I have a kiss, {targetName}? Please? Just one tiny one!",
      rested: "You look all cozy and happy today. I love that!",
      tired: "You need sleep, {targetName}. Even the cutest little animals curl up when they're tired.",
      food: "You should eat! I don't want my favorite person getting all wobbly.",
      prayer: "It's Anan! Can we go get our blessing together? Please?",
      communion: "Spirit Communion is tonight! Let's go together and look at all the pretty lights.",
      festival: "There's a festival! We have to go see everything, {targetName}!",
      harvest: "Oh! {harvestCount} crops are ripe and no one's picking them. Maybe we can make something yummy!",
      family: "Want to go see my family at the carpenters'? Kaboku might drop by too!",
      inn: "Can we go to the inn? Maybe they'll have something sweet!",
      home: "I saw something adorable today. I'll tell you all about it when we're home!"
    },
    namui_u_hakaru: {
      kiss: "A kiss before you disappear into trouble, {targetName}? Consider it a sound investment.",
      rested: "Well rested, well prepared. I knew marrying you was clever.",
      tired: "You're overextending yourself. Come home and sleep; tomorrow's problems can wait.",
      food: "A sharp mind runs poorly on an empty stomach, {targetName}. Eat first, scheme later.",
      prayer: "Anan is our chance to renew a week's blessing. We'd be fools to waste it, wouldn't we?",
      communion: "The Spirit Communion tonight might offer more insight than a dozen arguments. Come with me.",
      festival: "There's a festival on. We ought to go; people are wonderfully unguarded when they're happy.",
      harvest: "{harvestCount} ripe crops aren't covered by farmwork. It's a poor bargain to let them spoil.",
      inn: "Let's go hear the gossip at the inn, {targetName}. Information comes cheaper over a drink.",
      home: "I can think of no better plan than finding you waiting at home."
    },
    sloomi: {
      kiss: "{targetName}... would you stay for a kiss? I've been hoping you'd ask.",
      rested: "You look peaceful today. I like seeing you that way.",
      tired: "You seem tired. I know what it's like to carry too much in silence. Please rest.",
      food: "You haven't had a proper meal, have you? ...I'd feel better if you ate.",
      prayer: "It's Anan. Maybe we could go to temple together. There's comfort in the quiet.",
      communion: "I was thinking about Spirit Communion tonight. Could we go together?",
      festival: "There's a festival. Crowds are difficult for me... but with you, I think I'd like to go.",
      harvest: "{harvestCount} crops are ready outside the assigned fields. I noticed them earlier.",
      inn: "Would you sit with me at the inn a while? Somewhere quiet, if we can find it.",
      home: "I never used to look forward to coming home quite like this."
    },
    foroji_funji: {
      kiss: "One kiss, {targetName}, before the day sweeps us into separate verses?",
      rested: "Ah, you've slept deeply. Even the morning sounds sweeter around you.",
      tired: "The day has taken its toll, my love. Let sleep mend the song.",
      food: "A song needs breath, and a wanderer needs supper. Eat something, {targetName}.",
      prayer: "It's Anan, and the temple waits like a held note. Shall we seek our blessing?",
      communion: "Spirit Communion tonight... imagine the music of all those quiet hearts. Come with me.",
      festival: "There's a festival in the air! Come, {targetName}, let us join its melody.",
      harvest: "{harvestCount} ripe crops are waiting without a harvester. Even a field needs its final refrain.",
      inn: "Let's visit the inn. Perhaps a new song is hiding among its stories.",
      home: "May every road you walk lead you back to me at dusk."
    },
    oddclaw_unumanuk: {
      kiss: "A kiss before you go, {targetName}. A small promise, faithfully kept.",
      rested: "Good. Rest is part of readiness, and you're ready for the day.",
      tired: "You need proper rest, {targetName}. Even the strongest guard takes a watch off.",
      food: "Don't neglect your provisions. Eat before you head out.",
      prayer: "Anan is here. We should attend temple and renew our blessing together.",
      communion: "Spirit Communion calls tonight. I'd be honored to have you beside me.",
      festival: "There's a festival to attend, {targetName}. We'll not miss our neighbors' celebration.",
      harvest: "{harvestCount} crops stand ready without assigned harvesters. We ought to put that right.",
      inn: "Shall we visit the inn? It's good to know one's neighbors.",
      home: "Come home safely, {targetName}. I'll keep a light for you."
    },
    takua_ao_hakaru: {
      kiss: "Hey, {targetName}. Come here a second. A kiss is easier than explaining how much I missed you.",
      rested: "You look rested. Smart move. I was thinking of trying that myself.",
      tired: "You look tired. We should sleep. I was already pretty committed to the idea.",
      food: "You haven't eaten? That's... actually a worse plan than most of mine.",
      prayer: "Oh, right, it's Anan. We can still get our week's blessing if we go to temple.",
      communion: "Spirit Communion tonight? Sounds like a good excuse to go somewhere together.",
      festival: "There's a festival. We should go before I find a convincing reason not to move.",
      harvest: "Uh, {harvestCount} crops are ripe outside the farmwork jobs. I meant to tell you earlier.",
      inn: "Want to go to the inn? I've got a plan. Mostly it involves sitting down.",
      home: "If you're headed home, {targetName}, I'll try not to be asleep when you get there."
    },
    jubmir: {
      kiss: "Hey, {targetName}. Come give me a kiss before you wander off.",
      rested: "Good, you got some sleep. You look ready for a proper day out.",
      tired: "You look about done in. Get some rest, yeah? I'll see to things.",
      food: "Have you eaten? Better fill your belly before you go traipsing off.",
      prayer: "It's Anan. We ought to drop by temple for that weekly blessing.",
      communion: "Spirit Communion's tonight. Fancy going together?",
      festival: "There's a festival on! Come on, it'd be a shame to miss it.",
      harvest: "There's {harvestCount} ripe crops with nobody set to pick 'em. We should sort that out.",
      inn: "Fancy a trip to the inn, {targetName}? We could catch up with everyone.",
      home: "You take care of yourself out there, {targetName}. I'll be glad when you're back."
    }
  });

  const FAMILY_ROLES = Object.freeze({ // Canonical graph supplies membership; these authored labels avoid mistaking siblings for parents.
    aliri_ginju: { gorobi_ginju: 'Father-in-law', gikali_ginju: 'Mother-in-law', gantami_ginju: 'Sibling-in-law' },
    nashka_khibu: { dzibim_khibu: 'Father-in-law', dzahiri_khibu: 'Mother-in-law', kaboku_kunji: 'Family-in-law' },
    sloomi: { kzubug: 'Father-in-law' },
    namui_u_hakaru: { takua_ao_hakaru: 'Brother-in-law' },
    takua_ao_hakaru: { namui_u_hakaru: 'Sister-in-law' },
    oddclaw_unumanuk: { teacup_unumanuk: 'Family-in-law', spearhead_unumanuk: 'Family-in-law' }
  });

  const FAMILY_SPEECH = Object.freeze({ // Used by both in-law greetings and fallback conversations.
    gorobi_ginju: "Aliri has chosen well, {targetName}. Take good care of each other.",
    gikali_ginju: "You're part of our family now, {targetName}. There's always a place for you here.",
    gantami_ginju: "So you're family now, {targetName}. I suppose we'll be seeing a lot more of each other!",
    dzibim_khibu: "Nashkha's happiness means a great deal to us. You're welcome here, {targetName}.",
    dzahiri_khibu: "It's lovely to have you in the family, {targetName}. Do come visit.",
    kaboku_kunji: "Ah, another of the family, {targetName}! Pull up a chair.",
    kinami_kunji: "So marriage has brought you into the family, {targetName}. I hope you'll be kind to one another.",
    kzubug: "Sloomi doesn't open her heart easily. I'm glad she has you, {targetName}.",
    namui_u_hakaru: "So you've married my brother, {targetName}. Do try to keep him out of trouble.",
    takua_ao_hakaru: "Well, you married my sister. She's probably already figured you out, {targetName}.",
    teacup_unumanuk: "You and Oddclaw are family now, {targetName}. Treat each other honorably.",
    spearhead_unumanuk: "You're one of us now, {targetName}. Make each other proud."
  });

  const lastSelection = { npcId: null, topic: null, available: [], relation: null }; // Mobile diagnostics show the actual event-time choice.

  function spouseId() { return window.RomanceSystem?.getSpouse?.()?.npcId || null; }
  function familyGraph() {
    return (window.SCRATCHBONES_CONFIG?.game?.socialRelationships?.relationships || []).filter(edge =>
      Array.isArray(edge?.members) && edge.members.length >= 2);
  }
  function familyRoles() {
    const spouse = spouseId();
    if (!spouse) return {};
    const relations = familyGraph();
    const family = new Set();
    for (const edge of relations) {
      if (edge.type === 'family' && edge.members.includes(spouse)) {
        edge.members.filter(id => id !== spouse).forEach(id => family.add(id));
      }
    }
    const roles = {};
    for (const npcId of family) roles[npcId] = FAMILY_ROLES[spouse]?.[npcId] || 'Family-in-law';
    // Partners of a direct relative are extended kin, not automatically parents or siblings.
    for (const edge of relations) if (edge.type === 'partner' && edge.members.some(id => family.has(id))) {
      for (const id of edge.members) if (id !== spouse && !family.has(id)) roles[id] = 'Family-in-law';
    }
    return roles;
  }
  function relationshipFor(npcId) {
    if (!npcId) return null;
    if (npcId === spouseId()) return 'Spouse';
    return familyRoles()[npcId] || null;
  }
  function relatedNpcIds() {
    const spouse = spouseId();
    return spouse ? [spouse, ...Object.keys(familyRoles())] : [];
  }
  function gameHour() { return Number(window.CalendarSystem?.getHour?.()); }
  function currentDay() { return Number(window.CalendarSystem?.timeDebugSnapshot?.()?.rawDay); }
  function isAnan() { return window.CalendarSystem?.currentWeekdayName?.() === 'Anan'; }
  function festival() { return window.FestivalCalendar?.current?.() || null; }
  function unassignedHarvest() {
    const count = window.FarmEditor?.unassignedReadyHarvestCount?.();
    return Number.isFinite(count) && count > 0 ? count : 0;
  }
  function outingAvailable(kind) {
    const h = gameHour();
    if (!Number.isFinite(h)) return false;
    if (kind === 'prayer') return isAnan() && !!window.TemplePrayerRestBlessings && !window.TemplePrayerRestBlessings.activePrayer?.(); // No unavailable/duplicate weekly prayer invitations.
    if (kind === 'communion') return isAnan() && h >= 0 && h < 3; // Temple's authored Spirit Communion layout ends at 03:00.
    if (kind === 'festival') return !!festival() && !!window.FestivalSystem?.festivalHours?.(); // Respect each festival's real gathering window, including events that run past midnight.
    if (kind === 'family') return spouseId() === 'nashka_khibu' && h >= 13 && h < 20;
    if (kind === 'inn') return h >= 16 && h < 22;
    return false;
  }
  function pickStation(role, area) {
    const stations = window.NpcScheduling?.findStationsByRole?.(role, { area }) || [];
    return stations.find(station => Number.isFinite(Number(station.c)) && Number.isFinite(Number(station.r))) || null;
  }
  function destinationFor(kind) {
    if (!outingAvailable(kind)) return null;
    if (kind === 'communion' || kind === 'prayer') {
      const station = pickStation(kind === 'communion' ? 'spirit_communion' : 'sit', 'map_i_temple');
      if (station) return { ...station, activity: kind === 'communion' ? 'attending Spirit Communion with you' : 'praying together' };
      return { area: 'map_i_temple', c: 9, r: 11, activity: kind === 'communion' ? 'attending Spirit Communion with you' : 'praying together' }; // Known central aisle; works before distant interior seating is loaded.
    }
    if (kind === 'family') {
      const station = window.NpcScheduling?.resolveNpcStationTarget?.('furniture_chair_map_i_carpenters_13_10') || pickStation('sit', 'map_i_carpenters');
      return station ? { ...station, activity: 'visiting the Khibu family with you' } : { area: 'map_i_carpenters', c: 12, r: 10, activity: 'visiting the Khibu family with you' };
    }
    if (kind === 'inn') {
      const station = pickStation('sit', 'map_i_inn');
      return station ? { ...station, activity: 'spending time at the inn with you' } : { area: 'map_i_inn', c: 15, r: 8, activity: 'spending time at the inn with you' };
    }
    if (kind === 'festival') {
      const props = window.FestivalSystem?.activityProps?.() || [];
      const prop = Array.isArray(props) ? props.find(p => Number.isFinite(Number(p.col)) && Number.isFinite(Number(p.row))) : null;
      return prop ? { area: prop.area || 'town', c: prop.col, r: prop.row, activity: 'enjoying ' + festival().name + ' with you' }
        : { area: 'town', c: 26, r: 34, activity: 'heading to ' + festival().name + ' with you' }; // Known town-square gathering area.
    }
    return null;
  }

  function hash(text) {
    let value = 2166136261;
    for (const char of text) { value ^= char.charCodeAt(0); value = Math.imul(value, 16777619); }
    return value >>> 0;
  }
  function hasFoodBuff() {
    const entries = window.EffectBuffBar?.getEntries?.();
    if (Array.isArray(entries)) {
      if (entries.some(entry => entry.sourceId === 'food' ||
        (entry.sourceId === 'festivals' && String(entry.key || '').startsWith('festival-meal:')))) return true;
    }
    return (window.CookingSystem?.foodBuffEntries?.() || []).length > 0; // Covers regular food when the HUD provider has not registered yet.
  }

  function selectAdvice(npcId) {
    const voice = VOICES[npcId];
    if (!voice || spouseId() !== npcId) return null;
    const h = gameHour();
    const candidates = []; // Each candidate is valid only while its authoritative buff, calendar or farm state says so.
    const add = (kind, priority, line, outing = null) => {
      if (typeof line === 'string' && line.trim()) candidates.push({ kind, priority, line, outing });
    };
    const harvestCount = unassignedHarvest();
    if (outingAvailable('communion')) add('communion', 98, voice.communion, 'communion');
    if (outingAvailable('prayer')) add('prayer', 95, voice.prayer, 'prayer');
    if (outingAvailable('festival')) add('festival', 92, voice.festival, 'festival');
    if (harvestCount) add('harvest', 84, voice.harvest);
    if (window.RomanceSystem?.remainingKissHours?.() <= 0) add('kiss', 79, voice.kiss);
    if (typeof window.CookingSystem?.foodBuffEntries === 'function' && !hasFoodBuff()) add('food', 71, voice.food);
    if (window.TemplePrayerRestBlessings && !window.TemplePrayerRestBlessings.isWellRested?.()) add('tired', 62, voice.tired);
    if (outingAvailable('family')) add('family', 56, voice.family, 'family');
    if (outingAvailable('inn')) add('inn', 53, voice.inn, 'inn');
    if (window.TemplePrayerRestBlessings?.isWellRested?.()) add('rested', 45, voice.rested);
    add('home', Number.isFinite(h) && h >= 20 ? 60 : 20, voice.home);
    const day = Number.isFinite(currentDay()) ? currentDay() : 0;
    candidates.sort((a, b) => (b.priority + hash(npcId + ':' + day + ':' + b.kind) % 13)
      - (a.priority + hash(npcId + ':' + day + ':' + a.kind) % 13));
    const picked = candidates[0];
    const line = picked.line.replace(/\{harvestCount\}/g, String(harvestCount));
    lastSelection.npcId = npcId;
    lastSelection.topic = picked.kind;
    lastSelection.available = candidates.map(c => c.kind);
    return { ...picked, line };
  }
  function greetingsFor(npcId, fallback) {
    const advice = selectAdvice(npcId);
    return advice ? [advice.line] : fallback;
  }
  function spouseConversation(rec) {
    const advice = selectAdvice(rec.id);
    if (!advice) return null;
    const text = advice.line.replace(/\{targetName\}/g, '{{playerLocalNickname}}');
    const outing = advice.outing && destinationFor(advice.outing);
    if (!outing) return { id: 'spouse_care_' + rec.id + '_' + advice.kind, entryNode: 'intro', trigger: 'interact',
      nodes: [{ id: 'intro', type: 'text', text }] };
    return {
      id: 'spouse_care_' + rec.id + '_' + advice.kind, entryNode: 'intro', trigger: 'interact',
      nodes: [
        { id: 'intro', type: 'choice', text, choices: [
          { label: "Let's go together.", next: null, actions: [{ type: 'spouse-social-life', op: 'outing', kind: advice.outing }] },
          { label: 'Maybe later.', next: null }
        ] }
      ]
    };
  }
  function inLawSpeech(npcId) {
    const spouse = spouseId();
    const relative = window.RomanceSystem?.helpers?.npcName?.(spouse) || 'your spouse';
    return FAMILY_SPEECH[npcId] || ("You and " + relative + " are family now, {targetName}. You're welcome with us.");
  }
  function treeFor(rec, { defaultTree } = {}) {
    if (!rec?.id || rec.dead || rec.deceased) return null;
    if (defaultTree && !String(defaultTree.id || '').endsWith('_fallback')) return null; // Never suppress authored quests, shops, or cutscene conversations.
    if (spouseId() === rec.id && VOICES[rec.id]) return spouseConversation(rec);
    const relation = relationshipFor(rec.id);
    if (!relation || relation === 'Spouse' || window.FestivalDialogue?.active?.()) return null; // Existing Gorkunash-specific conversations win over generic in-law greetings.
    lastSelection.relation = { npcId: rec.id, label: relation };
    return { id: 'marriage_family_' + rec.id + '_' + spouseId(), entryNode: 'intro', trigger: 'interact',
      nodes: [{ id: 'intro', type: 'text', text: inLawSpeech(rec.id).replace(/\{targetName\}/g, '{{playerLocalNickname}}') }] };
  }
  function greetingFor(rec, context) {
    if (!rec?.id || rec.dead || rec.deceased) return null;
    const relation = relationshipFor(rec.id);
    if (!relation || relation === 'Spouse' || window.FestivalDialogue?.active?.()) return null; // Preserve special Gorkunash greetings.
    const targetName = context?.omitTargetName ? '' : String(context?.targetName || '');
    return inLawSpeech(rec.id).replace(/\s*,\s*\{targetName\}/g, targetName ? ', ' + targetName : '')
      .replace(/\{targetName\}/g, targetName);
  }
  function handleOuting(action, context) {
    if (action?.op !== 'outing' || context?.npc?.id !== spouseId()) return { ok: false, message: 'That invitation is no longer available.' };
    const target = destinationFor(action.kind);
    if (!target) return { ok: false, message: 'That outing is no longer available right now.' };
    const ok = window.RomanceSystem?.startSpouseOuting?.(action.kind, target);
    return { ok: !!ok, message: ok ? 'Your spouse is heading out with you. Follow them to ' + (action.kind === 'prayer' || action.kind === 'communion' ? 'the temple' : action.kind === 'festival' ? 'the festival' : action.kind === 'family' ? 'the carpenters' : 'the inn') + '.' : 'Your spouse cannot leave just now.' };
  }

  window.DialogueContent?.registerContextProvider?.('spouse-social-life', { treeFor, greetingFor });
  window.DialogueContent?.registerActionHandler?.('spouse-social-life', handleOuting);
  window.SpouseSocialLife = Object.freeze({
    selectAdvice, greetingsFor, relationshipFor, relatedNpcIds, familyRoles, treeFor, greetingFor, outingAvailable, destinationFor,
    diagnostics: () => ({ ...lastSelection, spouseId: spouseId(), family: familyRoles(), outing: window.RomanceSystem?.activeSpouseOuting?.() || null })
  });
})();
