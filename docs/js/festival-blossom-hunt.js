// Feast of the Five Blossoms: an annual, seven-day five-locale riddle hunt.
// Riddle creation is intentionally delegated to the reusable LocaleRiddleGenerator.
(() => {
  'use strict';
  const PREFIX = 'five_blossoms_wilderness_hunt:'; // Each civil year gets a separate saved quest record.
  const TITLE = 'The Five Wandering Blossoms'; // TasksPanel and completion toasts use this player-facing quest name.
  const BLOSSOMS = Object.freeze([
    { id: 'cyan', name: 'Cyan Blossom', color: '#00ffff', zoneId: 'map_northern_cliffs', paletteIndex: 0 },
    { id: 'white', name: 'White Blossom', color: '#ffffff', zoneId: 'map_western_slope', paletteIndex: 2 },
    { id: 'gold', name: 'Golden Blossom', color: '#ffbf00', zoneId: 'map_western_slope', paletteIndex: 3 },
    { id: 'amber', name: 'Amber Blossom', color: '#ff8000', zoneId: 'map_southern_cloud_forest', paletteIndex: 1 },
    { id: 'rose', name: 'Rose Blossom', color: '#ffb3b3', zoneId: 'map_southern_cloud_forest', paletteIndex: 4 }
  ].map(item => Object.freeze({ ...item, localeId: 'locale_five_blossoms_' + item.id }))); // Five authored locale files; two share the southern forest.
  let mapDeps = null; // WildernessMap supplies canonical member/world's generated zone layouts and player tile scale.
  let questDeps = null; // TasksPanel supplies the same member save authority used by other story quests.
  let unsubTile = null; // Released on world/character reinit so duplicate listeners cannot award a find twice.
  let visibleScene = null; // Scene owner of the five-tree renderer; replaced cleanly on zone transitions.
  let visibleZone = ''; // Active map ID used to avoid scanning inactive wilderness zones per frame.
  let visibleTrees = new Map(); // Per-locale Three.js roots attached to the currently active scene.
  let calendarKey = ''; // Day/year/Shift change gate; ordinary animation frames do not touch quest saves.
  let retrySaveAfter = 0; // A failed member write retries on a later calendar tick, rather than disabling the quest for the whole festival.
  let lastStatus = ''; // Visible on mobile to explain absent locales, failed saves, or withheld clues.
  let lastGenerated = null; // Debug snapshot describes which final terrain evidence made it into the clue.
  let registeredYear = null; // Registers real character-owned blossom inventory items once per civil year.
  let pickPromptEl = null; // Mobile/touch button is the same explicit pick action as the controller Action 3 claim.
  let advertisedPick = ''; // Avoid reinstalling GameplayInputRouter claims on each 200ms festival tick.
  let turnInRunning = false; // Disallows double-awards while a cutscene awaits dialogue input.
  let lastTurnIn = null; // Developer mobile snapshot reports first/later awards and failed saves.

  function year() { return Number(window.CalendarSystem?.aotYearNumber?.()); }
  function active() { return window.FestivalCalendar?.current?.()?.id === 'five_blossoms'; }
  function key(y = year()) { return PREFIX + y; }
  function records() { return questDeps?.getQuestProgress?.() || window.QuestProgressStore?.snapshot?.() || {}; }
  function state() { return records()[key()]; }
  function itemKey(blossomId, civilYear = year()) { return 'five_blossom_' + blossomId + '_' + String(civilYear); } // Each year's five real items are independent of last year's unsubmitted flowers.
  function registerItems() {
    const civilYear = year();
    if (!Number.isSafeInteger(civilYear) || registeredYear === civilYear || !window.KeyItemSystem?.defineMany) return false;
    window.KeyItemSystem.defineMany(BLOSSOMS.map(b => ({id:itemKey(b.id,civilYear),label:b.name,icon:'🌸',scope:'character',
      desc:'A hand-picked blossom from the Feast of the Five Blossoms, to be presented to Father Hunundi Hodu.'}))); // Canonical Pack Key Items are real, persistent, character-owned items.
    registeredYear = civilYear;
    return true;
  }
  function targetFor(found = []) { return BLOSSOMS.find(blossom => !found.includes(blossom.id)) || null; } // The primary riddle is ordered, but opportunistic discoveries are credited in any order.
  function zoneLayout(id) { return mapDeps?._zoneLayouts?.get?.(id) || null; }
  function localeFor(blossom) {
    return zoneLayout(blossom?.zoneId)?.localeInstances?.find?.(entry => entry.localeId === blossom.localeId) || null;
  }
  function blossomColor(blossom) {
    return window.FestivalProps?.blossomWindowSwatches?.[blossom.paletteIndex]?.color || blossom.color; // Temple overpass swatches remain the colour authority even if festival furniture is retinted later.
  }
  function statusFor(blossom) {
    const layout = zoneLayout(blossom?.zoneId); // The same generated layout is consulted for both visual placement and factual clue selection.
    const locale = localeFor(blossom);
    return { layout, locale, generated: !!layout, stamped: !!locale };
  }
  function clueFor(blossom) {
    const { layout, locale } = statusFor(blossom);
    if (!locale || !layout) return { ok: false, reason: 'The blossom locale is not available in this generated wilderness yet; check the mobile placement diagnostics.' };
    return window.LocaleRiddleGenerator?.generate?.({
      zoneId: blossom.zoneId, layout, instance: locale, targetObjectKey: 'blossom-tree', targetName: blossom.name, targetKind: 'blossom',
      landmarks: [
        ...(window.WildernessLandmarkScenery?.landmarksFor?.(blossom.zoneId, layout) || []),
        ...(window.CaveSiteSystem?.outdoorPuzzleSitesForZone?.(blossom.zoneId) || []).map(site => ({
          name:'a cliff door', point:{col:Number(site.mouthAnchor?.x),row:Number(site.mouthAnchor?.y)},source:'registered-cliff-door'
        }))
      ],
      seed: [mapDeps?.tothalWorldId?.() || 'world', mapDeps?.currentTothalYear?.() || 'shift', blossom.id, locale.x, locale.y].join(':')
    }) || { ok: false, reason: 'LocaleRiddleGenerator is not loaded' };
  }
  function descriptor(founds = [], shift = null) {
    const remaining = targetFor(founds); // The first undiscovered blossom supplies the active clue without invalidating other discoveries.
    if (!remaining) return { kind:'story', provider:'blossomHunt', icon:'🌸', title:TITLE, npcName:'Father Hunundi Hodu',
      objective:'Present all five hand-picked blossoms to Father Hunundi Hodu in town.',
      detail:'All five blossoms are in your Pack. Speak with Father Hunundi before the Feast ends to claim the Five Blossom Crown.',
      found:founds.slice(0,5), ready:true, year:year(), shiftYear:shift };
    const clue = clueFor(remaining);
    lastGenerated = clue;
    lastStatus = clue.ok ? `Generated clue for ${remaining.id} from ${clue.facts.length} verified descriptors` : clue.reason;
    return {
      kind: 'story', provider: 'blossomHunt', icon: '🌸', title: TITLE,
      npcName: 'The Feast of the Five Blossoms',
      objective: `Find the ${remaining.name} Tree (${founds.length}/5). The search ends when the festival week ends.`,
      detail: clue.ok ? clue.text : `Seek the ${remaining.name} in ${window.LocaleRiddleGenerator?.ZONES?.[remaining.zoneId] || remaining.zoneId}. ${clue.reason}`,
      found: founds.slice(0, 5), year: year(), shiftYear: shift, target: remaining.id
    };
  }
  function write(status, progress) {
    const result = window.QuestProgressStore?.setStatus?.(key(), status, progress);
    if (result === false || result == null) {
      calendarKey = ''; // A transient save failure must not suppress the next year's start/expiry.
      retrySaveAfter = Date.now() + 5000; // Prevent expensive repeated disk writes on every 200ms festival tick.
      lastStatus = 'Member save rejected the blossom quest update';
      window.__farmLog?.('[blossom-hunt] ' + lastStatus, 'warn');
      return false;
    }
    return true;
  }
  function start() {
    registerItems();
    if (!questDeps || !mapDeps || !active() || !Number.isInteger(year()) || year() < 0) return;
    if (state()) return; // Completion and expiry records are annual; never restart the same festival year.
    const shift = mapDeps.currentTothalYear?.() ?? null;
    if (write('active', descriptor([], shift))) {
      lastStatus = 'Quest begun during the seven-day feast';
      mapDeps.showToast?.('New quest: The Five Wandering Blossoms. Read the first riddle in your Quest Log.', true);
    }
  }
  function expireOutdated() {
    const all = records(); // A small saved quest dictionary, inspected only on calendar/Shift changes.
    for (const [questId, record] of Object.entries(all)) {
      if (!questId.startsWith(PREFIX) || record?.status !== 'active') continue;
      if (active() && questId === key()) continue;
      const saved = window.QuestProgressStore?.setStatus?.(questId, 'expired', {
        objective: 'The Feast of the Five Blossoms has ended.', detail: 'Return next year for a new set of riddles.', hidden: true
      });
      if (saved) lastStatus = 'Unfinished annual hunt expired at the festival boundary';
      else { calendarKey = ''; retrySaveAfter = Date.now() + 5000; } // Failed expiry is retried rather than resurrecting the old active quest forever.
    }
  }
  function syncCalendar() {
    if (!questDeps || !mapDeps) return;
    registerItems();
    const civilYear = year(); // Used as a readiness gate so an unloaded calendar cannot accidentally expire a saved annual quest.
    if (!Number.isSafeInteger(civilYear) || window.CalendarSystem?.isInitialized?.() === false) return;
    const shift = mapDeps.currentTothalYear?.() ?? 'unknown';
    const newKey = [civilYear, active() ? 'festival' : 'ordinary', shift].join(':');
    if (newKey === calendarKey || Date.now() < retrySaveAfter) return;
    retrySaveAfter = 0;
    calendarKey = newKey;
    expireOutdated();
    if (active()) start();
    const live = state();
    if (active() && live?.status === 'active' && String(live.progress?.shiftYear ?? '') !== String(shift ?? '')) {
      write('active', descriptor(Array.isArray(live.progress.found) ? live.progress.found : [], shift)); // Re-roll a clue after a Shift: old terrain facts cannot survive reshuffling.
    }
  }
  function clearTrees() {
    for (const node of visibleTrees.values()) node.parent?.remove?.(node);
    visibleTrees.clear();
    visibleScene = null;
    visibleZone = '';
  }
  function buildVisibleTrees() {
    const area = mapDeps?.getCurrentArea?.();
    if (!BLOSSOMS.some(item => item.zoneId === area)) { if (visibleTrees.size) clearTrees(); return; } // Blossom locales exist all year; only collecting them is festival-limited.
    const scene = window.GridTileAccessors?.getActiveScene?.();
    if (!scene) return;
    if (visibleScene !== scene || visibleZone !== area) clearTrees();
    visibleScene = scene; visibleZone = area;
    for (const blossom of BLOSSOMS) {
      if (blossom.zoneId !== area || visibleTrees.has(blossom.localeId)) continue;
      const instance = localeFor(blossom);
      const foliage = window.FoliageGenerator?.buildPottedBlossomTreeMesh;
      if (!instance || !foliage) { lastStatus = 'Blossom scene missing ' + blossom.localeId; continue; }
      const p = window.LocaleRiddleGenerator?.positionOf?.(instance, 'blossom-tree');
      if (!Number.isFinite(p?.col) || !Number.isFinite(p?.row)) continue;
      const color = blossomColor(blossom); // Never duplicate the temple's live colour-fill palette in an event renderer.
      const tree = foliage(blossom.localeId + ':' + p.col + ':' + p.row, color); // Public builder reuses cached Three.js geometry/materials; one cheap instance per active scene.
      if (!tree) continue;
      tree.scale.multiplyScalar(36); // A ~6-unit flowering landmark after the tabletop preset's quarter scale.
      tree.traverse?.(child => { if (child.geometry) child.userData.festivalSharedFoliage = true; }); // Zone teardown must not dispose the foliage generator's globally shared GPU buffers.
      tree.name = blossom.localeId;
      tree.userData.festivalBlossomHunt = { id: blossom.id, zoneId: area, color, localeId: blossom.localeId };
      const tilePixels = Number(mapDeps?.TILE) || 64; // ClimbSystem's worldSurfaceY sampler takes movement/pixel units, not map tiles.
      const rawHeight = window.ClimbSystem?.groundYAt?.((p.col + .5) * tilePixels, (p.row + .5) * tilePixels); // Sample the actual highland/mire floor beneath the blossom.
      const height = Number(rawHeight); // Surface height includes the generated plateau when available.
      tree.position.set(p.col + .5, rawHeight != null && Number.isFinite(height) ? height : 0, p.row + .5);
      scene.add(tree);
      visibleTrees.set(blossom.localeId, tree);
    }
  }
  function nearbyTree(tile = window.PlayerTileEvents?.current?.()) {
    if (!active() || !tile || state()?.status !== 'active') return null;
    const found = Array.isArray(state()?.progress?.found) ? state().progress.found : []; // A visible tree is not necessarily still pickable this year.
    let best = null, distance = Infinity;
    for (const blossom of BLOSSOMS) {
      if (blossom.zoneId !== tile.area || found.includes(blossom.id)) continue;
      const locale = localeFor(blossom), point = locale && window.LocaleRiddleGenerator?.positionOf?.(locale,'blossom-tree');
      if (!Number.isFinite(point?.col) || !Number.isFinite(point?.row)) continue;
      const d = Math.hypot(tile.col - point.col,tile.row - point.row);
      if (d <= 3 && d < distance) {best=blossom;distance=d;} // Actual reachable tree, not its displayed riddle or an invented landmark.
    }
    return best;
  }
  function pickBlossom(blossomId, tile = window.PlayerTileEvents?.current?.()) {
    syncCalendar(); registerItems();
    const blossom = nearbyTree(tile), live = state();
    if (!blossom || blossom.id !== blossomId || !active() || live?.status !== 'active') return false;
    const item = window.KeyItemSystem?.grant?.(itemKey(blossom.id));
    if (!item?.ok) { lastStatus = 'Could not store the blossom item: '+(item?.message||'Pack not available'); return false; }
    const previous = Array.isArray(live.progress?.found) ? live.progress.found : [];
    const next = [...previous,blossom.id]; // Only a real interaction with the physical tree advances the next riddle.
    if (!write('active',descriptor(next,mapDeps.currentTothalYear?.() ?? null))) {
      if (item.granted) window.KeyItemSystem?.revoke?.(itemKey(blossom.id)); // Roll back the newly picked item if quest progress cannot save.
      return false;
    }
    mapDeps.showToast?.(next.length === BLOSSOMS.length
      ? 'Five blossoms picked! Return to Father Hunundi Hodu in town to present them.'
      : blossom.name+' picked and added to Pack. Your next riddle awaits ('+next.length+'/5).',true);
    lastStatus = 'Picked '+blossom.id+' by interaction ('+next.length+'/5)'; syncPickPrompt();
    return true;
  }
  function createPickPrompt() {
    if (typeof document === 'undefined' || !document.body?.appendChild) return null;
    let button = document.getElementById?.('fiveBlossomsPick');
    if (button) return button;
    button = document.createElement('button'); // A tangible tap target for mobile; Action 3 remains the controller/keyboard route.
    button.id = 'fiveBlossomsPick';button.type = 'button';button.hidden = true;
    button.setAttribute('aria-label','Pick blossom from tree');
    button.style.cssText = 'position:fixed;bottom:calc(13vh + 70px);left:14px;z-index:1100;min-height:48px;min-width:150px;padding:10px 14px;border-radius:10px;background:#355d40;color:#fff;border:2px solid #e0bb66;font:700 14px system-ui;box-shadow:0 3px 12px #0008;touch-action:manipulation;';
    button.addEventListener('click',() => {const target=nearbyTree();if(target)pickBlossom(target.id);}); // Rechecks actual player distance on tap.
    document.body.appendChild(button);
    return button;
  }
  function syncPickPrompt() {
    const target = nearbyTree();
    const next = target?.id || '';
    if (!pickPromptEl) pickPromptEl = createPickPrompt();
    if (pickPromptEl) {
      pickPromptEl.hidden = !target;
      if (target) pickPromptEl.textContent = '🌸 Pick '+target.name;
    }
    if (next === advertisedPick) return; // Reusing one prompt/claim eliminates frame- or tick-level input registration churn.
    advertisedPick = next;
    const router = window.GameplayInputRouter || window.WorldActionInputClaims;
    if (!target) router?.clearClaims?.('five-blossoms-tree');
    else router?.setClaims?.('five-blossoms-tree',[{actionId:'action3',priority:65,label:'Pick '+target.name,
      onPress:() => pickBlossom(target.id)}]); // Action 3 avoids commandeering weapon swings near the tree.
  }
  function onTile() {
    syncCalendar();
    buildVisibleTrees();
    syncPickPrompt(); // Moving near a blossom only makes Pick available: never automatically collects a flower.
  }
  function init(deps) {
    mapDeps = deps;calendarKey = '';retrySaveAfter = 0;registeredYear = null;turnInRunning = false;lastTurnIn = null;
    unsubTile?.();
    unsubTile = window.PlayerTileEvents?.subscribe?.(onTile) || null;
    advertisedPick = '__reset__'; // New member/world must not inherit another character's targeting.
    clearTrees(); registerItems(); syncPickPrompt();
    window.DevCompanion?.registerStateProvider?.('fiveBlossomsHunt',debugSnapshot);
  }
  function bindQuestDeps(deps) { questDeps = deps;calendarKey = '';retrySaveAfter = 0;registerItems(); }
  function update() {
    syncCalendar();buildVisibleTrees();syncPickPrompt(); // Uses the existing festival low-frequency tick; never scans other zones per frame.
  }
  function menuStatus() {
    const live = state();
    const inProgress = live?.status === 'active' && active();
    const found = Array.isArray(live?.progress?.found) ? live.progress.found : [];
    const upcoming = targetFor(found); // The final step is a physical NPC turn-in, not a sixth location.
    const ready = inProgress && !upcoming && BLOSSOMS.every(b=>window.KeyItemSystem?.has?.(itemKey(b.id)));
    const liveClue = inProgress && upcoming ? clueFor(upcoming) : null;
    return { active: inProgress,ready,objective:live?.progress?.objective || '',
      statusText: inProgress ? (ready?'All 5 collected — return to Father Hunundi in town.' : found.length+' of 5 picked — festival time is limited.') : null,
      detail: inProgress && upcoming ? (liveClue?.ok ? liveClue.text : 'Seek '+upcoming.name+' in '+(window.LocaleRiddleGenerator?.ZONES?.[upcoming.zoneId] || upcoming.zoneId)+'. '+(liveClue?.reason || 'Clue unavailable.')) : live?.progress?.detail || '' };
  }
  async function turnInAtHunundi(walker) {
    const live=state(),profile=window.__hobunjiPlayerProfile,nowYear=year();
    if(turnInRunning || !active() || !Number.isSafeInteger(nowYear) || live?.status!=='active'
      || walker?.rec?.id!=='father_hunundi_hodu' || !menuStatus().ready)
      return {ok:false,message:'Pick all five blossoms and speak to Father Hunundi during the Feast.'};
    if(!profile?.worldId || !profile?.characterId || !window.EquipmentPanel?.awardFiveBlossomCrown)
      return {ok:false,message:'Your character or clothing gear is not ready for the award.'};
    turnInRunning = true;
    let headwear = null, first = false, firstFinder = null;
    try {
      const claim=window.WorldMetaStore?.claimFiveBlossomsFinder?.(profile.worldId,nowYear,profile.characterId,profile.nickname);
      if(!claim?.ok)throw Error('Could not record this year’s first Finder: '+(claim?.reason || 'world save unavailable'));
      first = claim.first; firstFinder = claim.winner;
      const alreadyCrowned = window.EquipmentPanel.ownsFiveBlossomCrown?.(nowYear) === true; // Completion-save retries must not repeat a ceremony after the crown was already granted.
      if(first && !alreadyCrowned) {
        const ceremony=window.FestivalBlossomCeremony;
        if(!ceremony?.play) throw Error('The festival crowning cinematic is not loaded');
        headwear=window.EquipmentPanel.beginFiveBlossomCrowning?.();
        if(!headwear)throw Error('Could not prepare the player’s festival outfit');
        const played=await ceremony.play({profile,civilYear:nowYear,onProclaim:() =>
          !!window.EquipmentPanel.awardFiveBlossomCrown(nowYear,headwear)});
        if(!played?.ok)throw Error(played?.reason || 'Could not complete the announcement on stage');
        window.EquipmentPanel.finishFiveBlossomCrowning?.(headwear,true); // Saved full outfit contains the crown AND restored hood before the quest's own member save.
        headwear = null;
      } else if(!window.EquipmentPanel.awardFiveBlossomCrown(nowYear)) throw Error('Could not award the crown');
      const completed={...descriptor(BLOSSOMS.map(b=>b.id),mapDeps?.currentTothalYear?.() ?? null),
        objective:'Five Blossom Crown received from Father Hunundi Hodu.',
        detail:first?'You were proclaimed this year’s first Finder of the Five Blossoms before the village.'
          :'You completed the challenge after the first Finder and received your own crown.',
        ready:false,crowned:true,firstFinder:first,firstFinderName:firstFinder?.name || null};
      if(!write('completed',completed))throw Error('Could not persist the completed hunt. The award is saved; turn in again to retry.');
      for(const blossom of BLOSSOMS)window.KeyItemSystem?.revoke?.(itemKey(blossom.id)); // Hand in physical flower items only after crown and completion save succeed.
      lastTurnIn={year:nowYear,first,winner:firstFinder?.name,characterId:profile.characterId};lastStatus='Awarded Five Blossom Crown ('+(first?'first finder':'later finder')+')';
      mapDeps?.showToast?.(first?'You are this year’s Finder of the Five Blossoms!':'Five Blossom Crown awarded — congratulations!',true);
      syncPickPrompt();
      return {ok:true,first,winner:firstFinder?.name};
    }catch(error){
      if (first && !window.EquipmentPanel?.ownsFiveBlossomCrown?.(nowYear)) {
        const released = window.WorldMetaStore?.releaseFiveBlossomsFinder?.(profile.worldId,nowYear,profile.characterId); // A staging failure must not block the next human finisher from becoming the actual first Finder.
        if (!released) window.__farmLog?.('[blossom-hunt] Could not release unawarded first-Finder reservation','warn');
      }
      lastStatus = 'Crowning failed: '+String(error?.message||error);window.__farmLog?.('[blossom-hunt] '+lastStatus,'error');
      mapDeps?.showToast?.(lastStatus,false);
      return {ok:false,message:lastStatus};
    } finally {
      if(headwear)window.EquipmentPanel?.finishFiveBlossomCrowning?.(headwear,headwear.crowned);
      turnInRunning=false;
    }
  }
  function debugSnapshot() {
    const live = state();
    return {
      activeFestival: active(), questId: key(), status: live?.status || 'not_started', found: live?.progress?.found || [],
      target: live?.progress?.target || null, currentZone: mapDeps?.getCurrentArea?.(),
      present: BLOSSOMS.map(item => ({ id: item.id, zoneId: item.zoneId, stamped: !!localeFor(item) })),
      displayedTrees: [...visibleTrees.keys()], lastStatus, retrySaveAfter,
      nearbyPick:nearbyTree()?.id || null,advertisedPick,registeredYear,turnInRunning,lastTurnIn,
      clueEvidence: lastGenerated?.evidence || null, clueValid: lastGenerated?.ok || false
    };
  }
  window.FestivalBlossomHunt = Object.freeze({ init,bindQuestDeps,update,menuStatus,debugSnapshot,BLOSSOMS,
    pickBlossom,nearbyTree,turnInAtHunundi,itemKey,
    __test:{descriptor,clueFor,pickBlossom,syncCalendar,registerItems,syncPickPrompt} });
})();
