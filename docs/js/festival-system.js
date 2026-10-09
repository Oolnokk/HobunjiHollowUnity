// Persistent festival rules and activity handlers. UI, authored props, and NPC conversations share this authority.
(() => {
  'use strict';
  let deps = null; // Runtime-owned inventory, scene, NPC, and persistence closures.
  let state = { claims: {}, blessing: null }; // Saved per member; each annual event has independent claim keys.
  let dance = null; // Session-only timed participation; leaving the area cancels without awarding.
  let lastTick = 0; // Low-frequency game-loop work and dance elapsed time.
  let effectiveCache = null; // Reused by activity and NPC queries until the raw map or resolved layout changes.
  let residentCache = []; // Refreshed at most once every two seconds as NPC records finish loading.
  let residentCacheAt = -Infinity; // Millisecond stamp for the resident cache.
  const costumeState = new WeakMap(); // Each walker redraws only when its event costume changes.
  let lastCostumeTick = -Infinity; // Rare costume refreshes share the existing game-loop tick.
  let lastError = ''; // Copied by the mobile diagnostics panel.
  const handlers = new Map(); // Extensible activity handler registry; no second action dispatcher in the UI.
  const HOME_IDS = new Set(['ginju_farmstead', 'little_swamp_house', 'general_store', 'smithy', 'inn', 'temple', 'potion_shop', 'carpenters', 'unumanuk_household']); // Existing resident households invited to town festivities.
  const MASKS = ['gar-wolf', 'grehlr', "uumkao'ii", 'voorg-ass']; // Existing festival cosmetics, granted as normal wearable clothing.
  const STORY = [ // Placeholder prose preserves the user’s story without inventing another kingdom or protagonist.
    'When the last Mao’ao kingdom stood against the Hachutu, people feared the dark magic of their masks.',
    'One wise lad discovered that their magic had no effect on those who did not fear them.',
    'So the people wore silly masks of their own. They mocked the Hachutu’s terrible masks with ridiculous animals and laughter.',
    'They made a joke of what had frightened them, and defeated their enemy with ease. Tonight we laugh, share sweets, and practice meeting a challenge without fear.',
  ];
  function festival() { return window.FestivalCalendar.current(); }
  function year() { return window.CalendarSystem.aotYearNumber(); }
  function day() { return year() * 336 + window.FestivalCalendar.ordinal(window.CalendarSystem.monthNumber(), window.CalendarSystem.dayOfMonth()) - 1; }
  function eventKey(f = festival()) { return f ? `${year()}:${f.id}` : ''; }
  function claims(f = festival()) { return state.claims[eventKey(f)] || {}; }
  function claimed(key, f) { return !!claims(f)[key]; }
  function mark(key, value = true, f = festival()) { (state.claims[eventKey(f)] ||= {})[key] = value; }
  function commit(message) {
    deps.refresh?.();
    deps.save?.();
    window.EffectBuffBar?.refresh(true);
    if (message) deps.toast?.(message, true);
    return { ok: true, message };
  }
  function fail(message) { lastError = message; deps?.toast?.(message, false); return { ok: false, message }; }
  function registerActivity(id, handler) { if (id && typeof handler === 'function') { handlers.set(id, handler); return true; } return false; }
  function rawMap() { return deps?.getTownMap?.() || null; }
  function layout() {
    const raw = rawMap(); // Preserve the edited map identity so live reflection invalidates this cache.
    const id = window.MapLayoutSystem?.resolveActiveLayout(raw)?.id || 'default';
    if (!effectiveCache || effectiveCache.raw !== raw || effectiveCache.id !== id) effectiveCache = { raw, id, data: window.MapLayoutSystem?.getEffectiveMapData(raw) };
    return effectiveCache.data;
  }
  function activityProps() { return (layout()?.decor || []).filter(p => p.activity?.type && festival()?.activities.includes(p.activity.type)); }
  function propCenter(prop) {
    const size = deps?.getDecorSize?.(prop.key) || {}; // Matches makeDecorativeFurnitureMesh's unrotated placement anchor.
    return { c: prop.col + (size.fw || 1) * .5 + (Number(prop.postX) || 0), r: prop.row + (size.fd || 1) * .5 + (Number(prop.postZ) || 0) };
  }
  function atProp(prop) {
    if (!deps || deps.getArea() !== 'town' || !prop) return false;
    const position = deps.getPlayerTile(); // Same placement offsets as TownZoneBuildings.
    const center = propCenter(prop); // Activity and rendered furniture share exactly one center.
    return Math.hypot(position.c - center.c, position.r - center.r) <= Math.max(1, Math.min(8, Number(prop.activity?.radius) || 2.5));
  }
  function nearestActivity() {
    if (!festival() || deps?.isBlocked?.()) return null;
    const position = deps.getPlayerTile(); // Sort the few activity anchors, never scene-traverse.
    const distance = prop => { const center = propCenter(prop); return Math.hypot(position.c - center.c, position.r - center.r); }; // Use the rendered center for differently sized tables and rugs.
    return activityProps().filter(atProp).sort((a, b) => distance(a) - distance(b))[0] || null;
  }
  function actionButton() {
    if (dance) return { icon: '■', label: 'Leave festival dance', action: 'festival_stop_dance', allowed: true, style: 'secondary' };
    const prop = nearestActivity(); // Activity remains tied to the prop when moved in the editor.
    return prop ? { icon: festival().icon, label: prop.activity.label || window.FestivalCalendar.activityLabels[prop.activity.type], action: 'festival_activity', allowed: true, style: 'primary' } : null;
  }
  function npcRewardAction(walker) {
    if (!walker?.rec?.id || deps?.isBlocked?.()) return null;
    const id = walker.rec.id; // Same annual claims as the gift table, so the two routes cannot duplicate rewards.
    if (festival()?.id === 'mountaindawn' && favorHearts(id) >= 3 && !claimed(`gift:${id}`)) return { icon: '🎁', label: 'Receive Mountaindawn gift', action: 'festival_npc_gift', style: 'secondary', allowed: true };
    if (festival()?.id === 'hachutukara' && residents().some(rec => rec.id === id) && !claimed(`sweet:${id}`)) return { icon: '🍬', label: 'Ask for sweets', action: 'festival_npc_sweet', style: 'secondary', allowed: true };
    return null;
  }
  function receiveNpcReward(walker, action) {
    const offer = npcRewardAction(walker); // Do not trust an old action-bar button after a date, NPC, or favor change.
    const position = deps?.getPlayerTile?.();
    if (!offer || offer.action !== action || walker.area !== deps.getArea() || !walker.root?.position || Math.hypot(position.c - walker.root.position.x, position.r - walker.root.position.z) > 3) return fail('Move closer to your friend to receive their gift.');
    return handlers.get(action === 'festival_npc_gift' ? 'gifts' : 'sweets')({ npcId: walker.rec.id });
  }
  function perform(type, payload = {}) {
    const f = festival(); // Recheck everything on commit, including stale UI after midnight or travel.
    const prop = activityProps().find(p => p.id === payload.propId && p.activity.type === type);
    if (!f || !f.activities.includes(type) || !atProp(prop) || deps?.isBlocked?.()) return fail('Return to this festival activity area to take part.');
    const handler = handlers.get(type); // Mechanics are reusable independently of any particular holiday.
    if (!handler) return fail('This activity is unavailable.');
    return handler(payload, prop, f);
  }
  function residents() {
    if (performance.now() - residentCacheAt >= 2000) { residentCache = (deps?.getNpcs?.() || []).filter(rec => HOME_IDS.has(rec.homeId) && !rec.deceased && !rec.dead && !String(rec.role || '').includes('deceased')); residentCacheAt = performance.now(); }
    return residentCache;
  }
  function favorHearts(id) { return window.NpcFavorBalance?.relationshipHeartsForNpc?.(id) ?? (Number(window.DialogueContent?.getNpcDlgState?.(id)?.favor) || 0) / 40; }
  function giveFavor(id, amount, reason) { return window.DialogueContent?.adjustNpcFavor?.(id, amount, `festival_${reason}`); }
  function allFavor(amount, reason) { for (const rec of residents()) giveFavor(rec.id, amount, reason); }
  function grantItem(key, count = 1, stars = 3) {
    if (!key || !deps.getItemDefs()[key] || !Number.isInteger(count) || count <= 0) return false;
    const owned = Number(deps.inventory[key]) || 0; // Preflight capacity before consuming a claim.
    if (owned + count > (window.InventoryStacks?.MAX_TOTAL || 9999)) return false;
    deps.inventory[key] = owned + count;
    window.CookingSystem?.recordItemQuality?.(key, stars, count);
    return true;
  }
  function qualityChoices(kind) {
    return Object.entries(deps?.inventory || {}).filter(([key, count]) => {
      const def = deps.getItemDefs()[key]; // Only physical giftable items; coins/equipment/quest objects cannot become offerings.
      return count > 0 && def && (kind === 'potluck' ? def.isCookedFood : key !== 'gold' && !def.questItem && !def.isQuestItem && !def.isBlueprint && !def.isTool && window.NpcGifting?.isItemGiftable?.({ key, kind: 'item' }));
    }).flatMap(([key]) => (window.CookingSystem?.availableQualityEntries?.(key) || []).map(entry => ({ ...entry, key, label: deps.getItemDefs()[key].label || key })));
  }
  function consumeChoice(kind, payload) {
    if (!qualityChoices(kind).some(choice => choice.key === payload.key && choice.stars === payload.stars && choice.count >= 1)) return false;
    return window.CookingSystem.consumeQuality(payload.key, payload.stars, 1);
  }
  function giftMultiplier() { return festival()?.id === 'mountaindawn' ? 2 : 1; }
  function blessingMultiplier(stat) {
    if (!window.CalendarSystem?.isInitialized?.()) return 1;
    const buff = state.blessing; // Date-based expiry survives sleeping, reloading, year boundaries, and character switches.
    const def = window.FestivalCalendar.blessings[stat];
    return buff?.stat === stat && def && Number.isFinite(buff.expiresDay) && day() < buff.expiresDay ? 1 + Math.min(5, Math.max(1, buff.level)) * def.perLevel : 1;
  }
  function buffEntries() {
    const buff = state.blessing; // EffectBuffBar handles display alongside food and alchemy.
    if (!deps || !window.CalendarSystem?.isInitialized?.() || !buff || day() >= buff.expiresDay) return [];
    const def = window.FestivalCalendar.blessings[buff.stat];
    return def ? [{ key: 'ancestor-blessing', label: `${def.label} ${buff.level} · ${Math.ceil(buff.expiresDay - day())} days`, icon: def.icon, sourceLabel: 'Ancestor offering', durationS: 336, remainingS: buff.expiresDay - day(), stacks: buff.level }] : [];
  }
  function serialize() { return JSON.parse(JSON.stringify(state)); }
  function restore(saved) {
    residentCacheAt = -Infinity; effectiveCache = null;
    state = { claims: {}, blessing: null };
    if (saved?.claims && typeof saved.claims === 'object' && !Array.isArray(saved.claims)) {
      for (const [key, value] of Object.entries(saved.claims)) if (/^\d+:[a-z_]+$/.test(key) && value && typeof value === 'object' && !Array.isArray(value)) state.claims[key] = { ...value };
    }
    if (window.FestivalCalendar.blessings[saved?.blessing?.stat] && Number.isFinite(saved.blessing.expiresDay) && Number.isFinite(saved.blessing.level)) state.blessing = { stat: saved.blessing.stat, level: Math.max(1, Math.min(5, Math.trunc(saved.blessing.level))), expiresDay: saved.blessing.expiresDay };
    cancelDance();
    window.FestivalUI?.close?.();
  }
  function npcTarget(rec) {
    if (!deps || !festival() || deps.isFestivalSuspended?.() || !HOME_IDS.has(rec.homeId) || rec.deceased || rec.dead || rec.visitorPresence) return null;
    const hour = window.CalendarSystem.getHour(); // Decorations stay for seven whole days; gatherings respect nighttime rest.
    if (hour < 10 || hour >= 22 || (rec.id === 'spearhead_unumanuk' && window.CombatTutorial?.active?.())) return null;
    const stations = layout()?.npcStations || []; // Editor-authored positions and instrument metadata remain authoritative.
    const choices = stations.filter(st => st.festivalRole === 'guest');
    const assigned = stations.find(st => st.festivalNpcId === rec.id); // Hosts/music leaders keep dedicated activity stations.
    const index = residents().findIndex(npc => npc.id === rec.id);
    const selected = assigned || choices[index % Math.max(1, choices.length)];
    if (!selected || index < 0) return null;
    const target = window.NpcScheduling.resolveNpcStationTarget(selected.id); // A deferred scene swap can briefly leave the next layout's station unregistered.
    return target ? { ...target, activity: festival().name } : null;
  }
  function cancelDance() { if (dance) window.SocialActionWheel?.stopDance?.('festival-ended'); dance = null; }
  function update() {
    const now = performance.now(); // Called by gameLoop; no independent animation loop.
    if (now - lastTick < 200) return;
    const elapsed = Math.max(0, Math.min(.5, (now - lastTick) / 1000));
    lastTick = now;
    if (deps && now - lastCostumeTick >= 2000) {
      lastCostumeTick = now;
      for (const walker of deps.getWalkers()) {
        const costume = festival()?.id === 'hachutukara' && residents().some(rec => rec.id === walker.rec?.id) ? 'hachutukara' : '';
        if (costumeState.get(walker) !== costume && (costume || costumeState.has(walker))) void window.NpcWardrobe?.refreshWalkerAppearance?.(walker);
        costumeState.set(walker, costume);
      }
    }
    if (dance) {
      const prop = activityProps().find(p => p.id === dance.propId);
      if (eventKey() !== dance.event || !atProp(prop) || !window.SocialActionWheel?.getDebug?.().dancing) cancelDance();
      else if (!deps.isBlocked?.() && !document.hidden) {
        dance.elapsed += elapsed;
        if (dance.elapsed >= 20) {
          const key = dance.claimKey; // Preserve identity before releasing the social pose.
          cancelDance();
          if (!claimed(key)) { mark(key); allFavor(2, 'dance'); commit('Dance completed! +2 Favor with the townsfolk.'); }
          else deps.toast?.('A lovely dance. You have already earned this festival’s dance reward.', true);
        }
      }
    }
    window.FestivalUI?.update?.();
  }
  function diagnostics() {
    return { festival: festival()?.id || null, year: deps ? year() : null, layout: layout()?.activeLayoutId || 'default', activities: activityProps().map(p => ({ id: p.id, type: p.activity.type, col: p.col, row: p.row })), claims: claims(), blessing: state.blessing, dance, lastError, latestChange: 'Five seven-day festivals: live town layouts, editable activity props, attendance, quality-based rewards, and safe sparring.' };
  }
  function init(injected) {
    deps = injected;
    residentCacheAt = -Infinity;
    window.NpcWardrobe?.registerAppearanceDecorator('festivals', data => {
      if (festival()?.id !== 'hachutukara' || !residents().some(rec => rec.id === data.id)) return data;
      const index = [...data.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % MASKS.length; // Stable animal mask for each named resident.
      return { ...data, equippedCosmetics: [...(data.equippedCosmetics || []).filter(id => !id.startsWith('festivalmask_') && !['hood', 'hat'].includes(window.NpcWardrobe.slotForCosmetic(id))), `festivalmask_${MASKS[index]}`] };
    });
    window.NpcScheduling?.registerTargetOverride('festivals', npcTarget);
    window.EffectBuffBar?.registerProvider('festivals', buffEntries);
  }
  registerActivity('welcome', () => ({ ok: true }));
  registerActivity('remembrance', () => ({ ok: true }));
  registerActivity('potluck', payload => {
    if (claimed('potluck')) return fail('You have already contributed to this year’s feast.');
    if (!consumeChoice('potluck', payload)) return fail('Choose a cooked meal and a quality you still have.');
    const points = [0, 1, 3, 6, 10, 16][payload.stars]; // All meals welcome; exceptional cooking earns appreciably more town-wide Favor.
    mark('potluck', { key: payload.key, stars: payload.stars });
    allFavor(points, 'potluck');
    return commit(`${payload.stars}-star contribution: +${points} Favor with every townsfolk.`);
  });
  registerActivity('offering', payload => {
    if (claimed('offering')) return fail('You have already made this year’s offering.');
    if (!window.FestivalCalendar.blessings[payload.stat]) return fail('Choose a blessing before making your offering.');
    if (!consumeChoice('offering', payload)) return fail('Choose an offering and a quality you still have.');
    state.blessing = { stat: payload.stat, level: payload.stars, expiresDay: day() + 336 };
    mark('offering', { key: payload.key, stars: payload.stars, stat: payload.stat });
    return commit(`${window.FestivalCalendar.blessings[payload.stat].label}, level ${payload.stars}, for 336 days. Your previous ancestor blessing is replaced.`);
  });
  registerActivity('gifts', payload => {
    const rec = deps.getNpcs().find(npc => npc.id === payload.npcId); // Every eligible NPC can give once; the registry supplies named and loaded procedural NPCs.
    if (!rec || rec.deceased || rec.dead || String(rec.homeId || '').includes('deceased') || favorHearts(rec.id) < 3) return fail('This friend needs at least three hearts of Favor.');
    if (claimed(`gift:${rec.id}`)) return fail('You have already received this friend’s Mountaindawn gift.');
    const recipes = Object.values(window.AlchemySystem?.RECIPE_DEFS || {}).filter(recipe => recipe.useMode === 'drink' && recipe.traits?.drive === 'restore');
    if (!recipes.length) return fail('Gift supplies are still loading.');
    const hash = [...rec.id].reduce((sum, letter) => sum + letter.charCodeAt(0), year()); // Stable annual reward prevents rerolling by closing the menu or reloading.
    const recipe = recipes[hash % recipes.length];
    const key = window.AlchemySystem.ensureRecipeItemDef(recipe.id, 2); // Existing high-potency restorative, with normal inventory/use semantics.
    if (!grantItem(key, 2, 5)) return fail('Make room for your gift first.');
    mark(`gift:${rec.id}`);
    return commit(`${rec.name || rec.displayName || rec.id} gives you 2 × ${deps.getItemDefs()[key].label}.`);
  });
  registerActivity('sweets', payload => {
    const rec = residents().find(npc => npc.id === payload.npcId);
    if (!rec) return fail('Choose a townsfolk to collect sweets from.');
    if (claimed(`sweet:${rec.id}`)) return fail('You have already collected this friend’s sweets this year.');
    window.CookingSystem?.registerCookedDefinition?.('festivalSweet', { label: 'Hachutukara Sweet', icon: '🍬', desc: 'A ridiculous little animal made of sweet paste.', sellPrice: 8, foodQuality: 3, cookingDefaultStars: 3, cookingCategories: ['sweetPaste'], foodEffects: { vigor: 1 } }); // Register on grant, after the current character's cooking save has been restored.
    if (!grantItem('festivalSweet', 1)) return fail('Make room for a sweet first.');
    mark(`sweet:${rec.id}`);
    return commit(`${rec.name || rec.id} gives you an animal-shaped sweet.`);
  });
  registerActivity('masks', payload => {
    if (!MASKS.includes(payload.mask)) return fail('Choose one of the festival masks.');
    if (claimed('mask')) return fail('You have already chosen your free mask this year.');
    const id = `festivalmask_${payload.mask}`; // Existing hood cosmetic retains all authored tint layers and species variants.
    if (!deps.grantMask?.(id)) return fail('The mask is unavailable. Try again once its assets have loaded.');
    mark('mask');
    return commit('Your silly animal mask is in your clothing inventory. Equip it from the item panel.');
  });
  registerActivity('story', () => {
    const walker = deps.getWalkers().find(w => w.rec?.id === 'father_hunundi_hodu' && w.area === 'town');
    if (!walker) return fail('Father Hunundi tells the story here between 10:00 and 22:00.');
    window.FestivalUI.close();
    return deps.tellStory(walker, STORY);
  });
  registerActivity('dance', (payload, prop) => {
    if (dance) return fail('You are already dancing.');
    if (!window.SocialActionWheel?.startDance?.('gentle-twirl', 'tpose-jiggle')) return fail('The dance could not start.');
    dance = { propId: prop.id, event: eventKey(), elapsed: 0, claimKey: 'dance' };
    window.FestivalUI.close();
    deps.toast('Dance inside the marked court for 20 seconds. Leaving cancels; the Favor reward is once per festival.', true);
    return { ok: true };
  });
  registerActivity('music', () => { window.FestivalUI.close(); window.MusicMinigame?.beginPlayerSession(); return { ok: true }; });
  registerActivity('liquor', () => {
    if (claimed('liquor')) return fail('You have already received your festival bottle.');
    const key = Object.keys(deps.getItemDefs()).find(key => window.HobunjiDrunkGameplayBridge?.isAlcoholDef?.(deps.getItemDefs()[key]));
    if (!key || !grantItem(key, 1, 4)) return fail('No festival liquor is available, or your inventory is full.');
    mark('liquor');
    return commit(`A bottle of ${deps.getItemDefs()[key].label}. Hold it to drink or offer a swig through the existing item actions.`);
  });
  registerActivity('duel', (payload, prop) => {
    const walker = deps.getWalkers().find(w => w.rec?.id === 'spearhead_unumanuk' && w.area === 'town');
    if (!walker) return fail('Spearhead supervises the friendly duels here between 10:00 and 22:00.');
    if (window.CombatTutorial?.active()) return fail('Finish your current practice first.');
    window.FestivalUI.close();
    const arena = { area: 'town', ...propCenter(prop) }; // Moves with the editor-authored ring; the existing training system owns combat and cleanup.
    const duelEvent = eventKey(); // Availability and rewards remain tied to the event that actually started this round.
    const quest = { isAvailable: () => eventKey() === duelEvent, id: `festival_duel_${year()}`, title: 'Hachutukara — Laugh at Fear', transient: true, practice: arena, steps: [{ id: 'fearless', title: 'Friendly duel', text: 'Stand calmly against Oddclaw. Land three ordinary hits while he spars back. Our borrowed weapons cannot cost you your belongings, and we restore your resources when you finish or leave.', check: 'hit', count: 3, hostile: true, goal: 'Land three hits on Oddclaw', weapon: 'hatchet' }], onComplete: () => { if (eventKey() === duelEvent && !claimed('duel')) { mark('duel'); giveFavor('spearhead_unumanuk', 6, 'duel'); giveFavor('oddclaw_unumanuk', 6, 'duel'); commit('Fear faced! +6 Favor with Spearhead and Oddclaw.'); } } };
    return window.CombatTutorial.start(quest, walker);
  });
  window.FestivalSystem = { init, festival, year, claims, claimed, residents, favorHearts, qualityChoices, registerActivity, perform, actionButton, npcRewardAction, receiveNpcReward, nearestActivity, activityProps, atProp, update, cancelDance, giftMultiplier, blessingMultiplier, serialize, restore, diagnostics, MASKS, STORY, get dance() { return dance; }, getNpcs: () => deps?.getNpcs?.() || [] };
})();
