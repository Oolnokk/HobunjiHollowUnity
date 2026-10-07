// Player activity event bus — one place gameplay systems announce "the player
// just did X" (caught a fish, felled a tree, opened a chest, killed a
// creature, ...) so features that react to what the player does (the dating
// system's per-NPC likes, future achievements/quests) listen here instead of
// each wrapping a dozen unrelated modules.
//
// Emitters:   window.HobunjiActivityEvents?.emit('fish_caught', { itemKey });
// Listeners:  window.HobunjiActivityEvents.on(event => { event.type ... });
//             (also re-dispatched as a window 'hobunji-activity' CustomEvent)
//
// Activity types currently emitted (detail fields in parentheses):
//   fish_caught, tree_felled, rock_broken, ore_mined (oreKey), herb_picked,
//   crop_harvested (label), livestock_harvested (kind), meal_cooked (recipe),
//   potion_brewed, chest_opened (buried), creature_killed (creature,
//   isBandit, isBarbarian, isPredator), animal_petted (farm, kind),
//   nest_stolen (liveBirth), drink_accepted (npcId), dance (player started a
//   dance), dance_together (npcId), kurraya_played
(() => {
  'use strict';
  if (window.HobunjiActivityEvents) return;

  const listeners = new Set(); // Used to keep emit synchronous and ordered without DOM event overhead per listener.
  const recent = []; // Used by debugSnapshot for mobile-friendly verification of what was announced.
  const RECENT_LIMIT = 24;

  function emit(type, detail = {}) {
    const name = String(type || '').trim();
    if (!name) return false;
    const event = { type: name, at: Date.now(), ...detail };
    recent.push({ type: name, at: event.at });
    if (recent.length > RECENT_LIMIT) recent.shift();
    for (const listener of listeners) {
      try { listener(event); } catch (error) { console.warn('[HobunjiActivityEvents] listener failed', name, error); }
    }
    try { window.dispatchEvent(new CustomEvent('hobunji-activity', { detail: event })); } catch (_) {}
    return true;
  }

  function on(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  window.HobunjiActivityEvents = Object.freeze({
    emit,
    on,
    debugSnapshot: () => ({ listeners: listeners.size, recent: recent.slice() }),
  });
})();
