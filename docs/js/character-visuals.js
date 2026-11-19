// Character visuals: one enumeration of every drawn character, and the table of
// which visual systems cover which kind of character (window.CharacterVisuals).
//
// WHY THIS EXISTS
// The player, NPC walkers, enemies, creatures, companions, mounts and shoulder
// pets are all "characters" visually: PNG-plane portraits on rigs, with hands,
// pants, held tools/items, a ground shadow, outlines, and a response to the
// terrain and weather around them. Historically each visual system found its
// characters its own way (the composer's playerMesh, the planner's walker list,
// Combat's hostile/companion Sets, FarmAnimals' Set...) and many were written
// for the player first. This module is where a visual system asks "which
// characters are in this area?" so a new visual applies to every character by
// default, and where the coverage of each system is written down.
//
// RULE: a character visual is written for any character. If it can only serve
// the player today, add it to CAPABILITIES with `gap` explaining why, so the
// audit shows it, rather than adding another player-only path.
//
// API
//   KINDS                                  the character kinds below
//   registerProvider({ id, each(area, visit) })   visit(kind, root, entity, ownerRoot)
//   forEachCharacter(area, visit, kinds?)  live enumeration, no allocation per call
//   portraitMeshOf(root)                   the character's main PNG portrait mesh (cached)
//   CAPABILITIES                           system -> kinds covered, owner file, gaps
//   audit(area)                            counts by kind + capability table + player-only gaps
//
// game.js registers the provider (player, walkers, hostiles, companions,
// corpses, farm animals). Debug: `CharacterVisuals.audit()` in the console.
(() => {
  'use strict';

  if (window.CharacterVisuals) return;

  const KINDS = Object.freeze({
    PLAYER: 'player',
    NPC: 'npc', // Scheduled town/world NPC walkers.
    ENEMY: 'enemy', // Humanoid hostiles driven by BanditCombat (bandits, tribes, ghouls, skeletons, liches...).
    CREATURE: 'creature', // Hostile or wild animals.
    COMPANION: 'companion',
    MOUNT: 'mount',
    SHOULDER_PET: 'shoulderPet', // Companion perched on an owner character; ownerRoot is that character's root.
    CORPSE: 'corpse',
    FARM_ANIMAL: 'farmAnimal',
  });
  const ALL = Object.freeze(Object.values(KINDS));
  const HUMANOIDS = Object.freeze([KINDS.PLAYER, KINDS.NPC, KINDS.ENEMY]);
  const ANIMALS = Object.freeze([KINDS.CREATURE, KINDS.COMPANION, KINDS.MOUNT, KINDS.SHOULDER_PET, KINDS.CORPSE, KINDS.FARM_ANIMAL]);

  // Which character kinds each visual system serves. Keep this accurate when
  // you generalize or add a system; `gap` names what is still missing.
  const CAPABILITIES = Object.freeze([
    { id: 'held-tool-mesh', owner: 'character-held-tools.js', covers: HUMANOIDS,
      note: 'One factory builds every held tool/weapon plane. Mastery effects and metal plating come from the holder (player gear, enemy loadout), never implicitly from the player.' },
    { id: 'held-bag-item-plane', owner: 'game.js (updateHeldItemHolder)', covers: [KINDS.PLAYER],
      gap: 'NPCs hold tools/weapons through npc-held-equipment-v4.js but never bag items (food, flasks, seeds).' },
    { id: 'procedural-hands', owner: 'procedural-hand-frame-driver.js', covers: HUMANOIDS,
      note: 'One managed rig per avatar; grips come from hand-tool-grips.js for any holder.' },
    { id: 'pants-garment', owner: 'pants-garment-renderer.js', covers: HUMANOIDS,
      note: 'Player mesh resolution is higher unless the "Player uses the NPC mesh cap" setting is on.' },
    { id: 'ground-shadow', owner: 'character-ground-shadow.js', covers: ALL.filter(kind => kind !== KINDS.SHOULDER_PET) },
    { id: 'portrait-life', owner: 'world-portrait-life.js', covers: [KINDS.PLAYER, KINDS.NPC],
      gap: 'Blink/breathing/default expression for walkers only; enemies keep a static portrait (animals blink via creature-blink.js).' },
    { id: 'outline-occlusion', owner: 'png-plane-outline-occluder.js', covers: ALL,
      note: 'Every PNG plane joins PNG_OCCLUDER so outlines behind any character are hidden.' },
    { id: 'rig-transform-layers', owner: 'rig-transform-layers.js', covers: ALL,
      note: 'Per-node pose channels/leases shared by every rig.' },
    { id: 'render-body-composition', owner: 'player-body-transform-composer.js', covers: [KINDS.PLAYER, KINDS.SHOULDER_PET],
      gap: 'Render-time world-space body composition (stance yaw, lean, deadzone correction, head aim, neck limit) is player-only; NPC/enemy rigs apply their poses directly through rig-transform-layers.js. The shoulder pet is covered as an attachment of the player.' },
    { id: 'terrain-height', owner: 'movement (player/NPC/enemy) + animal-subtle-elevation-bridge.js', covers: ALL,
      note: 'Humanoid Y is movement-owned (terrain, walkable supports). Creatures, companions, mounts, corpses and farm animals get the render-time lift; a shoulder pet inherits its owner.' },
    { id: 'water-tint', owner: 'held-object-render-order.js', covers: [...HUMANOIDS, KINDS.SHOULDER_PET],
      note: 'Front/back portrait planes under translucent water or slush are tinted; feet that stand in water stay under it.' },
    { id: 'mist-depth-occluder', owner: 'cloud-forest-avatar-depth-occluder.js', covers: ALL,
      note: 'Cloud Forest mist / Western Slope blowing snow: any character whose portrait does not write depth gets a depth-only silhouette so mist layers sit behind it consistently.' },
    { id: 'shoulder-pet-perch', owner: 'shoulder-pet-attachment-runtime.js', covers: [KINDS.PLAYER],
      gap: 'The runtime is owner-generic (create({ getOwnerMesh, getOwnerNeckJoint })), but only the player owns a shoulder pet in gameplay today.' },
    { id: 'render-culling', owner: 'npc-view-frustum-cull.js, actor-render-occlusion.js', covers: [KINDS.NPC, KINDS.ENEMY, KINDS.CREATURE, KINDS.CORPSE],
      note: 'Render-only hiding of off-camera or covered characters; the player is never culled.' },
    { id: 'weather-wetness-snow-wind', owner: '(none)', covers: [],
      gap: 'No character shows rain wetness, snow on the body, or wind on clothing/fur. Absent for everyone, not player-only.' },
  ]);

  const providers = [];
  function registerProvider(spec) {
    if (!spec?.id || typeof spec.each !== 'function') throw new Error('CharacterVisuals.registerProvider needs { id, each }');
    const existing = providers.findIndex(provider => provider.id === spec.id);
    if (existing >= 0) providers.splice(existing, 1);
    providers.push({ id: spec.id, each: spec.each });
    return () => {
      const index = providers.findIndex(provider => provider.id === spec.id);
      if (index >= 0) providers.splice(index, 1);
    };
  }

  // visit(kind, root, entity, ownerRoot); return true from visit to stop early.
  function forEachCharacter(area, visit, kinds = null) {
    let stopped = false;
    const filtered = kinds ? (kind, root, entity, owner) => {
      if (stopped || !kinds.includes(kind)) return stopped;
      if (visit(kind, root, entity, owner) === true) stopped = true;
      return stopped;
    } : (kind, root, entity, owner) => {
      if (stopped) return true;
      if (visit(kind, root, entity, owner) === true) stopped = true;
      return stopped;
    };
    for (const provider of providers) {
      if (stopped) break;
      try { provider.each(area, filtered); }
      catch (error) { console.warn(`[CharacterVisuals] provider ${provider.id} failed`, error); }
    }
  }

  // The character's main PNG portrait mesh: the skinned/plain avatar mesh whose
  // materials are the shared avatar materials (player and NPC/enemy avatars all
  // use the npc_avatar_* material names). Cached per root; revalidated when the
  // cached mesh leaves the root (portrait rebuilds).
  const portraitCache = new WeakMap();
  function isUnder(object, root) {
    for (let node = object; node; node = node.parent) if (node === root) return true;
    return false;
  }
  function portraitScore(object) {
    if ((!object?.isMesh && !object?.isSkinnedMesh) || object.userData?.cloudForestAvatarDepthOccluder) return -1;
    const materials = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
    let score = 0;
    for (const material of materials) {
      const name = String(material?.name || '');
      if (name.includes('npc_avatar_skinned_')) score += 8;
      else if (name.includes('npc_avatar_')) score += 4;
      if (material?.map) score += 1;
    }
    return materials.length ? score : -1;
  }
  function portraitMeshOf(root) {
    if (!root?.traverse) return null;
    const cached = portraitCache.get(root);
    if (cached && isUnder(cached, root)) return cached;
    let best = null;
    let bestScore = 0;
    root.traverse(object => {
      const score = portraitScore(object);
      if (score > bestScore) { best = object; bestScore = score; }
    });
    if (best) portraitCache.set(root, best);
    else portraitCache.delete(root);
    return best;
  }

  function audit(area = null) {
    const counts = {};
    for (const kind of ALL) counts[kind] = 0;
    if (area != null) forEachCharacter(area, kind => { counts[kind] = (counts[kind] || 0) + 1; });
    return {
      area,
      characters: counts,
      providers: providers.map(provider => provider.id),
      capabilities: CAPABILITIES.map(entry => ({
        id: entry.id,
        owner: entry.owner,
        covers: entry.covers.slice(),
        missing: ALL.filter(kind => !entry.covers.includes(kind)),
        playerOnly: entry.covers.length === 1 && entry.covers[0] === KINDS.PLAYER,
        note: entry.note || null,
        gap: entry.gap || null,
      })),
      playerOnly: CAPABILITIES.filter(entry => entry.covers.length && entry.covers.every(kind => kind === KINDS.PLAYER || kind === KINDS.SHOULDER_PET)).map(entry => entry.id),
    };
  }

  window.CharacterVisuals = Object.freeze({
    KINDS,
    ALL_KINDS: ALL,
    HUMANOID_KINDS: HUMANOIDS,
    ANIMAL_KINDS: ANIMALS,
    CAPABILITIES,
    registerProvider,
    forEachCharacter,
    portraitMeshOf,
    audit,
  });
})();
