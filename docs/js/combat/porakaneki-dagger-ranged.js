// Dagger ranged bridge — keeps every generated dagger-sword fully usable as a
// melee weapon while also feeding it through the existing generic thrown-weapon
// archetype. Porakaneki dagger users can therefore throw at range without a
// second dagger-only projectile implementation.
(() => {
  'use strict';

  const VERSION = 1;
  const DAGGER_SHAPE = 'daggerSword'; // Used to identify every metal/material variant generated from the canonical dagger-sword shape.
  const RETRY_MS = 50; // Used while game.js finishes creating generated tool definitions.
  const RETRY_LIMIT = 160; // Used to stop bootstrap retries after roughly eight seconds.
  const patched = new Set(); // Used by mobile diagnostics to list exactly which generated dagger variants gained ranged behavior.
  let attempts = 0; // Used to bound the bootstrap retry loop.

  function patch() {
    const defs = window.Combat?.deps?.TOOL_ITEM_DEFS; // Existing generated weapon definitions remain the single source of melee stats/art.
    const archetypes = window.HobunjiRangedWeaponArchetypes; // Existing thrown-weapon bridge owns input, projectile creation, poses, and mastery integration.
    if (!defs || !archetypes?.patchGeneratedDefinitions) return false;

    let found = 0;
    for (const [itemKey, def] of Object.entries(defs)) {
      if (!def || (def.shapeKey || itemKey) !== DAGGER_SHAPE) continue;
      def.rangedType = 'thrown'; // Used by ranged-weapon-archetypes.js while leaving the original melee slot/animStyle intact for ordinary weapon use.
      if (!def.rangedProjectileSprite && def.sprite) def.rangedProjectileSprite = def.sprite;
      patched.add(itemKey);
      found += 1;
    }
    if (!found) return false;
    archetypes.patchGeneratedDefinitions();
    window.__farmLog?.(`[porakaneki] enabled melee+thrown ranged use for ${patched.size} dagger variant(s).`, 'combat');
    return true;
  }

  function debugSnapshot() {
    return { version: VERSION, daggerShape: DAGGER_SHAPE, attempts, patched: [...patched], ready: patched.size > 0 };
  }

  window.HobunjiPorakanekiDaggerRanged = Object.freeze({ version: VERSION, patch, debugSnapshot, formatDebug: () => {
    const d = debugSnapshot();
    return `Porakaneki dagger ranged: ready=${d.ready} patched=${d.patched.length} attempts=${d.attempts} items=${d.patched.join(',') || '-'}`;
  }});

  if (patch()) return;
  const timer = setInterval(() => {
    attempts += 1;
    if (patch() || attempts >= RETRY_LIMIT) clearInterval(timer);
  }, RETRY_MS);
})();
