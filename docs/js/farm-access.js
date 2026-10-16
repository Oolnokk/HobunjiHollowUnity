// Farm name, ownership, and farmhand permissions (moved out of game.js).
//
// World data (non-gear inventory, NPC relationships, quest progress) stays
// behind in the world's per-character member record rather than following
// the character between worlds — the opposite of gear, skills, and stats,
// which live on the character record and always travel with them.
// isWorldOwner/farmhandPermissions are decided once at save-select time
// (onboarding.js) and carried on the session's player data; a real
// farmhand's grants only change between sessions until networking exists to
// push a live update.
//
// The farm name reuses world.label, the same field set at world creation in
// onboarding.js. Every write goes straight to the hobunjiSaveMeta record, the
// same pattern game.js's saveGearInventory uses.
//
// game.js calls init(deps) once and keeps local aliases of the exports.
(() => {
  'use strict';
  if (window.FarmAccess) return;

  const SAVE_META_KEY = 'hobunjiSaveMeta';
  const DEFAULT_FARM_NAME = 'Hobunji Hollow';

  let deps = null; // { getWorldId, getPlayerData, showToast }
  let debugFarmRoleOverride = null; // Devtools-only role simulator state (see setDebugFarmRole).

  const worldId = () => deps?.getWorldId?.() || null;
  const playerData = () => deps?.getPlayerData?.() || null;

  function readSaveMeta() {
    return JSON.parse(localStorage.getItem(SAVE_META_KEY) || 'null');
  }

  function currentWorld(meta) {
    const id = worldId();
    return (meta?.worlds || []).find(w => w.id === id) || null;
  }

  function getFarmName() {
    if (!worldId()) return playerData()?.worldLabel || DEFAULT_FARM_NAME;
    try { return currentWorld(readSaveMeta())?.label || DEFAULT_FARM_NAME; } catch { return DEFAULT_FARM_NAME; }
  }

  function setFarmName(label) {
    const trimmed = String(label || '').trim();
    if (!worldId() || !trimmed) return;
    try {
      const meta = readSaveMeta();
      const world = currentWorld(meta);
      if (!world) return;
      world.label = trimmed.slice(0, 40);
      localStorage.setItem(SAVE_META_KEY, JSON.stringify(meta));
      const data = playerData();
      if (data) data.worldLabel = world.label;
    } catch {}
  }

  // Owning character's nickname, for the Farm tab header — looked up by
  // ownerCharacterId since livestock/world records only hold ids, not
  // display names (mirrors how char.nickname is read at save-select).
  function getFarmOwnerName() {
    try {
      const meta = readSaveMeta();
      const world = currentWorld(meta);
      const owner = (meta?.characters || []).find(c => c.id === world?.ownerCharacterId);
      return owner?.nickname || 'Unknown';
    } catch { return 'Unknown'; }
  }

  // Single source of truth for the permission-key set within the game
  // runtime (onboarding.js keeps its own copy — the two share no module).
  function defaultFarmhandPermissions() {
    return { storage: false, plant: false, harvest: false, placeFurniture: false, alterFarm: false, livestock: false };
  }

  function defaultWorldMemberState() {
    return {
      nonGearInventory: {}, packClothing: [], npcRelationships: {}, questProgress: {},
      alcoholBottleSwigs: {}, npcAlcoholState: {}, npcWardrobeState: {}, npcDiscoveredGiftTraits: {},
      alchemyKnownEffects: {}, alchemyKnownRecipes: [], alchemyActiveEffects: [], alchemyReagentState: {}, wildBerryState: {}, cookingState: {},
      // A brand-new member has no legacy favor to fix, so it starts
      // already "migrated" — see DialogueContent's loadNpcRelationships/
      // _applyLegacyFavorRescale. A member saved before this field
      // existed loads it as undefined/falsy, which is what triggers the
      // one-time reset.
      npcFavorRescaleApplied: true,
      joinedAt: Date.now(),
    };
  }

  function isFarmOwner() {
    if (debugFarmRoleOverride) return debugFarmRoleOverride.isOwner;
    const data = playerData();
    return data ? !!data.isWorldOwner : true; // no world context yet — don't lock out solo play
  }

  function hasFarmPermission(action) {
    if (isFarmOwner()) return true;
    const perms = debugFarmRoleOverride ? debugFarmRoleOverride.permissions : playerData()?.farmhandPermissions;
    return !!(perms && perms[action]);
  }

  // Devtools-only role simulator so farmhand gating can be verified without
  // real multiplayer: window.__hobunjiSetFarmRole('farmhand', {plant:true})
  // or window.__hobunjiSetFarmRole('owner') to restore normal behavior.
  function setDebugFarmRole(role, permissions) {
    if (role === 'owner') { debugFarmRoleOverride = null; deps?.showToast?.('Debug: acting as farm owner.', true); return; }
    if (role === 'farmhand') {
      debugFarmRoleOverride = {
        isOwner: false,
        permissions: { ...defaultFarmhandPermissions(), ...permissions },
      };
      deps?.showToast?.('Debug: acting as farmhand ' + JSON.stringify(debugFarmRoleOverride.permissions), true);
      return;
    }
    console.warn('__hobunjiSetFarmRole: role must be "owner" or "farmhand"');
  }

  // Adds/updates a farmhand grant on the current world's save-meta record.
  // Exposed for the (future) invite/matchmaking UI and for devtools testing:
  // window.__hobunjiAddFarmhand(characterId, { storage: true }).
  function addFarmhand(characterId, permissions) {
    if (!worldId() || !characterId) return;
    try {
      const meta = readSaveMeta();
      const world = currentWorld(meta);
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
      if (!world.members[characterId]) world.members[characterId] = defaultWorldMemberState();
      localStorage.setItem(SAVE_META_KEY, JSON.stringify(meta));
    } catch {}
  }

  function removeFarmhand(characterId) {
    if (!worldId() || !characterId) return;
    try {
      const meta = readSaveMeta();
      const world = currentWorld(meta);
      if (!world) return;
      world.farmhands = (world.farmhands || []).filter(f => f.characterId !== characterId);
      localStorage.setItem(SAVE_META_KEY, JSON.stringify(meta));
    } catch {}
  }

  window.__hobunjiSetFarmRole = setDebugFarmRole;
  window.__hobunjiAddFarmhand = addFarmhand;
  window.__hobunjiRemoveFarmhand = removeFarmhand;

  window.FarmAccess = {
    init(injected) { deps = injected || null; },
    getFarmName,
    setFarmName,
    getFarmOwnerName,
    defaultFarmhandPermissions,
    defaultWorldMemberState,
    isFarmOwner,
    hasFarmPermission,
    setDebugFarmRole,
    addFarmhand,
    removeFarmhand,
  };
})();
