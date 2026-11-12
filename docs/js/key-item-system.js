// Save-scope-aware key items. Character keys travel with a character; world keys belong to a world.
(() => {
  'use strict';

  const global = window; // Used as the runtime export target and source of the active player profile.
  const SAVE_META_KEY = 'hobunjiSaveMeta'; // Used to persist key ownership through the same save blob as characters/worlds.
  const definitions = new Map(); // Used to resolve labels, save scope, and future feature gates for registered key items.
  const PACK_KEY_LIST_ID = 'invKeyList'; // Existing Inventory > Pack key-item section, refreshed after ownership changes.

  function normalizeDefinition(definition) { // Used to reject malformed key definitions before they can corrupt save ownership.
    if (!definition?.id) return null;
    const scope = definition.scope === 'world' ? 'world' : 'character'; // Used to constrain storage to the two supported save lifetimes.
    return { ...definition, id: String(definition.id), label: definition.label || String(definition.id), scope };
  }

  function define(definition) { // Used by quest/content modules to register an item before granting or querying it.
    const normalized = normalizeDefinition(definition); // Used as the canonical registry entry written below.
    if (!normalized) return null;
    definitions.set(normalized.id, normalized);
    renderPackKeys(); // New/late definitions must appear for keys already saved on the current world.
    return normalized;
  }

  function defineMany(items = []) { // Used to register a whole quest reward table at once.
    for (const item of items) {
      const normalized = normalizeDefinition(item); // Batch registration avoids one UI rebuild per definition.
      if (normalized) definitions.set(normalized.id, normalized);
    }
    renderPackKeys();
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

  function renderPackKeys() { // Populates the existing Inventory > Pack Key Items section from persistent ownership.
    const document = global.document; // DOM is optional in headless story/quest tests.
    const list = document?.getElementById?.(PACK_KEY_LIST_ID);
    if (!list) return false;
    try {
      const liveProfile = profile(); // Current character/world determines which keys are visible.
      const meta = readMeta(); // Read the large world-save blob once rather than once per key.
      const world = meta?.worlds?.find(entry => entry?.id === liveProfile?.worldId);
      const worldKeys = new Set(Array.isArray(world?.keyItems) ? world.keyItems : []); // World grants are shared by characters in this world.
      const characterKeysOwned = new Set(Array.isArray(liveProfile?.gearInventory?.keyItems) ? liveProfile.gearInventory.keyItems : []); // Personal keys travel with this character.
      const owned = [...definitions.values()].filter(definition => (definition.scope === 'world' ? worldKeys : characterKeysOwned).has(definition.id));
      const expandedKey = list.querySelector?.('.inv-key-chip[aria-expanded="true"]')?.dataset?.keyItemId || ''; // Preserve a tapped key's description across refreshes.
      const fragment = document.createDocumentFragment();
      if (!owned.length) {
        const empty = document.createElement('div'); // Existing empty-state class preserves the authored Pack layout.
        empty.className = 'inv-key-empty';
        empty.textContent = 'No key items yet.';
        fragment.appendChild(empty);
      }
      for (const definition of owned) {
        const button = document.createElement('button'); // Buttons support keyboard/controller selection and mobile tapping.
        button.type = 'button';
        button.className = 'inv-key-chip';
        button.dataset.keyItemId = definition.id;
        button.title = definition.desc || definition.label;
        button.setAttribute('aria-expanded', definition.id === expandedKey ? 'true' : 'false');
        const icon = document.createElement('span'); // Key icon is shown next to its actual authored label.
        icon.className = 'inv-key-icon';
        icon.textContent = definition.icon || '🗝️';
        const name = document.createElement('span'); // Label uses textContent so authored text cannot inject markup.
        name.className = 'inv-key-name';
        name.textContent = definition.label;
        const detail = document.createElement('span'); // Tap-to-expand explanation works without desktop hover/devtools.
        detail.className = 'inv-key-desc';
        detail.textContent = definition.desc || (definition.scope === 'world' ? 'Shared world key item.' : 'Character key item.');
        button.append(icon, name, detail);
        button.addEventListener('click', () => {
          const wasExpanded = button.getAttribute('aria-expanded') === 'true'; // Re-tapping collapses; changing selection closes the previous key.
          for (const other of list.querySelectorAll('.inv-key-chip[aria-expanded="true"]')) other.setAttribute('aria-expanded', 'false');
          button.setAttribute('aria-expanded', wasExpanded ? 'false' : 'true');
        });
        fragment.appendChild(button);
      }
      list.replaceChildren(fragment);
      return true;
    } catch (error) {
      global.__farmLog?.('[key-items] Could not refresh Pack key list: ' + String(error?.message || error), 'warn'); // Mobile-visible log rather than a silent UI exception.
      return false;
    }
  }

  function grant(itemOrId, fallbackDefinition = null) { // Used by quest rewards to persist a key in its authored save scope.
    const supplied = typeof itemOrId === 'object' ? itemOrId : fallbackDefinition; // Used to optionally register an inline authored definition.
    const registered = supplied ? define(supplied) : definitions.get(String(itemOrId)); // Used as the canonical scope/label for this grant.
    const definition = registered || definitions.get(String(itemOrId)); // Used to reject unknown bare ids instead of silently guessing scope.
    if (!definition) return { ok: false, granted: false, message: 'Unknown key item.' };
    const liveProfile = profile(); // Used to resolve the active save records.
    if (!liveProfile?.characterId || !liveProfile?.worldId) return { ok: false, granted: false, message: 'No active character/world.' };
    const meta = readMeta(); // Used to stage persistent ownership before touching the live character mirror.
    if (!meta) return { ok: false, granted: false, message: 'Save metadata is unavailable.' };

    let changed = false; // Used to report whether this call awarded a new persistent key or merely re-observed existing ownership.
    let syncCharacterOwnership = false; // Used to defer live character mutation until the persistent save write succeeds.
    if (definition.scope === 'character') {
      const character = meta.characters?.find(entry => entry?.id === liveProfile.characterId); // Used to validate the persistent character before any live ownership changes.
      if (!character) return { ok: false, granted: false, message: 'Active character record is missing.' };
      const gear = character.gearInventory || (character.gearInventory = {}); // Used as the persistent character key-item container.
      if (!Array.isArray(gear.keyItems)) gear.keyItems = [];
      changed = uniquePush(gear.keyItems, definition.id);
      syncCharacterOwnership = true;
    } else {
      const world = meta.worlds?.find(entry => entry?.id === liveProfile.worldId); // Used as the persistent world-wide key-item container.
      if (!world) return { ok: false, granted: false, message: 'Active world record is missing.' };
      if (!Array.isArray(world.keyItems)) world.keyItems = [];
      changed = uniquePush(world.keyItems, definition.id);
    }

    if (!writeMeta(meta)) return { ok: false, granted: false, message: 'Could not save key item ownership.' };
    if (syncCharacterOwnership) uniquePush(characterKeys(liveProfile), definition.id); // Used to mirror only successfully persisted character ownership into the live profile.
    renderPackKeys(); // New grants appear immediately without requiring a Pack reload.
    try {
      if (typeof global.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
        global.dispatchEvent(new global.CustomEvent('hobunji:key-item-granted', { detail: { id: definition.id, scope: definition.scope, granted: changed } })); // Used by already-loaded world visuals such as Banubu's hidden Color Pools door.
      }
    } catch (_) {}
    return { ok: true, granted: changed, definition };
  }

  function revoke(id) { // Used for consumed story keys: removal persists in the same save scope as the original award.
    const definition = definitions.get(String(id)); // Registered scope prevents accidentally mutating unrelated inventory records.
    if (!definition) return { ok: false, removed: false, message: 'Unknown key item.' };
    const liveProfile = profile(); // The active world/character must own any key being consumed.
    if (!liveProfile?.characterId || !liveProfile?.worldId) return { ok: false, removed: false, message: 'No active character/world.' };
    const meta = readMeta(); // Mutation operates on the canonical metadata, not a stale inventory mirror.
    if (!meta) return { ok: false, removed: false, message: 'Save metadata is unavailable.' };
    const owner = definition.scope === 'world'
      ? meta.worlds?.find(entry => entry?.id === liveProfile.worldId)
      : meta.characters?.find(entry => entry?.id === liveProfile.characterId);
    if (!owner) return { ok: false, removed: false, message: 'Key owner record is missing.' };
    const list = definition.scope === 'world' ? owner.keyItems : owner.gearInventory?.keyItems; // Consumes only the defined save-lifetime list.
    if (!Array.isArray(list) || !list.includes(definition.id)) return { ok: true, removed: false, definition };
    if (definition.scope === 'world') owner.keyItems = list.filter(entry => entry !== definition.id);
    else owner.gearInventory.keyItems = list.filter(entry => entry !== definition.id);
    if (!writeMeta(meta)) return { ok: false, removed: false, message: 'Could not save key item consumption.' };
    if (definition.scope === 'character') {
      const liveKeys = characterKeys(liveProfile); // Keep the character mirror consistent only after the persistent write succeeds.
      for (let i = liveKeys.length - 1; i >= 0; i--) if (liveKeys[i] === definition.id) liveKeys.splice(i, 1);
    }
    renderPackKeys(); // Consumed talismans and key-stones disappear from the Pack immediately.
    return { ok: true, removed: true, definition };
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

  function definitionFor(id) { return definitions.get(String(id)) || null; } // Used by diagnostics/tests without exposing the mutable registry itself.

  global.KeyItemSystem = { define, defineMany, definitionFor, has, grant, revoke, featureUnlocked, snapshot, renderPackKeys };
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', renderPackKeys); // The authored Pack section may be parsed after this script runs.
    document.addEventListener('hobunjiPlayerReady', renderPackKeys); // Loaded/imported saves show their keys after the active profile is restored.
  }
})();
