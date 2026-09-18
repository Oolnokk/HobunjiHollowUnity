// Save-scope-aware key items. Character keys travel with a character; world keys belong to a world.
(() => {
  'use strict';

  const global = window; // Used as the runtime export target and source of the active player profile.
  const SAVE_META_KEY = 'hobunjiSaveMeta'; // Used to persist key ownership through the same save blob as characters/worlds.
  const definitions = new Map(); // Used to resolve labels, save scope, and future feature gates for registered key items.

  function normalizeDefinition(definition) { // Used to reject malformed key definitions before they can corrupt save ownership.
    if (!definition?.id) return null;
    const scope = definition.scope === 'world' ? 'world' : 'character'; // Used to constrain storage to the two supported save lifetimes.
    return { ...definition, id: String(definition.id), label: definition.label || String(definition.id), scope };
  }

  function define(definition) { // Used by quest/content modules to register an item before granting or querying it.
    const normalized = normalizeDefinition(definition); // Used as the canonical registry entry written below.
    if (!normalized) return null;
    definitions.set(normalized.id, normalized);
    return normalized;
  }

  function defineMany(items = []) { // Used to register a whole quest reward table at once.
    for (const item of items) define(item);
  }

  function profile() { // Used to find the live character/world ids and character gear collection.
    return global.__hobunjiPlayerProfile || null;
  }

  function readMeta() { // Used by every ownership mutation/query that needs persistent character or world records.
    try { return JSON.parse(global.localStorage?.getItem(SAVE_META_KEY) || 'null'); } catch (_) { return null; }
  }

  function writeMeta(meta) { // Used after a key grant to atomically persist the modified save blob.
    if (!meta) return false;
    try { global.localStorage?.setItem(SAVE_META_KEY, JSON.stringify(meta)); return true; } catch (_) { return false; }
  }

  function uniquePush(list, id) { // Used to make grants idempotent across dialogue retries and repeated save calls.
    if (!Array.isArray(list)) return false;
    if (list.includes(id)) return false;
    list.push(id);
    return true;
  }

  function characterKeys(liveProfile = profile()) { // Used as the live mirror for character-scoped ownership and future feature checks.
    if (!liveProfile) return [];
    const gear = liveProfile.gearInventory || (liveProfile.gearInventory = {}); // Used as the character-traveling save container.
    if (!Array.isArray(gear.keyItems)) gear.keyItems = [];
    return gear.keyItems;
  }

  function has(id) { // Used by future feature gates to check either character- or world-scoped ownership.
    const definition = definitions.get(String(id)); // Used to decide which save lifetime owns this key.
    if (!definition) return false;
    const liveProfile = profile(); // Used to resolve the currently active character/world.
    if (!liveProfile) return false;
    if (definition.scope === 'character') return characterKeys(liveProfile).includes(definition.id);
    const meta = readMeta(); // Used to read the world's shared key item list.
    const world = meta?.worlds?.find(entry => entry?.id === liveProfile.worldId); // Used to scope world keys to the active world only.
    return Array.isArray(world?.keyItems) && world.keyItems.includes(definition.id);
  }

  function grant(itemOrId, fallbackDefinition = null) { // Used by quest rewards to persist a key in its authored save scope.
    const supplied = typeof itemOrId === 'object' ? itemOrId : fallbackDefinition; // Used to optionally register an inline authored definition.
    const registered = supplied ? define(supplied) : definitions.get(String(itemOrId)); // Used as the canonical scope/label for this grant.
    const definition = registered || definitions.get(String(itemOrId)); // Used to reject unknown bare ids instead of silently guessing scope.
    if (!definition) return { ok: false, granted: false, message: 'Unknown key item.' };
    const liveProfile = profile(); // Used to resolve the active save records.
    if (!liveProfile?.characterId || !liveProfile?.worldId) return { ok: false, granted: false, message: 'No active character/world.' };
    const meta = readMeta(); // Used to update persistent records in the same write as ownership.
    if (!meta) return { ok: false, granted: false, message: 'Save metadata is unavailable.' };

    let changed = false; // Used to report whether this call awarded a new key or merely re-observed existing ownership.
    if (definition.scope === 'character') {
      changed = uniquePush(characterKeys(liveProfile), definition.id);
      const character = meta.characters?.find(entry => entry?.id === liveProfile.characterId); // Used to persist the character-traveling copy.
      if (!character) return { ok: false, granted: false, message: 'Active character record is missing.' };
      const gear = character.gearInventory || (character.gearInventory = {}); // Used as the persistent character key-item container.
      if (!Array.isArray(gear.keyItems)) gear.keyItems = [];
      uniquePush(gear.keyItems, definition.id);
    } else {
      const world = meta.worlds?.find(entry => entry?.id === liveProfile.worldId); // Used as the persistent world-wide key-item container.
      if (!world) return { ok: false, granted: false, message: 'Active world record is missing.' };
      if (!Array.isArray(world.keyItems)) world.keyItems = [];
      changed = uniquePush(world.keyItems, definition.id);
    }

    if (!writeMeta(meta)) return { ok: false, granted: false, message: 'Could not save key item ownership.' };
    return { ok: true, granted: changed, definition };
  }

  function featureUnlocked(featureId) { // Used by future systems to gate features without knowing which reward item owns the feature.
    if (!featureId) return false;
    for (const definition of definitions.values()) { // Used to locate any registered key mapped to the requested feature.
      if (definition.featureId === featureId && has(definition.id)) return true;
    }
    return false;
  }

  function snapshot() { // Used by mobile-visible diagnostics and tests without requiring browser developer tools.
    const liveProfile = profile(); // Used to include active save ids beside owned key arrays.
    const meta = readMeta(); // Used to report world keys from persistent world state.
    const world = meta?.worlds?.find(entry => entry?.id === liveProfile?.worldId); // Used to scope diagnostics to the current world.
    return {
      characterId: liveProfile?.characterId || null,
      worldId: liveProfile?.worldId || null,
      characterKeys: [...characterKeys(liveProfile)],
      worldKeys: Array.isArray(world?.keyItems) ? [...world.keyItems] : [],
      definitions: [...definitions.values()].map(entry => ({ ...entry })),
    };
  }

  global.KeyItemSystem = { define, defineMany, has, grant, featureUnlocked, snapshot };
})();
