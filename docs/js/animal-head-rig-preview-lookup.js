// Makes legacy/explicit headRigForKind() callers honor the same browser-local
// Animal Head Rigger preview override as the newer build wrapper. Several animal
// builders pass headRigForKind(kind) explicitly, so without this adapter the
// explicit committed rig would bypass the painter's localStorage preview rig.
(() => {
  'use strict';

  const renderer = window.CreatureGeneticsRender;
  const speciesBridge = window.HobunjiAnimalHeadRigSpecies;
  if (!renderer || !speciesBridge?.resolveForOptions || renderer.__previewAwareHeadRigLookupInstalled) return;

  const committedLookup = typeof renderer.headRigForKind === 'function'
    ? renderer.headRigForKind.bind(renderer)
    : null; // Fallback only if the shared resolver cannot identify the supplied kind.

  renderer.headRigForKind = kind => {
    const resolved = speciesBridge.resolveForOptions({ creatureId: kind }); // Browser preview override wins inside the shared resolver.
    return resolved || committedLookup?.(kind) || null;
  };
  renderer.__previewAwareHeadRigLookupInstalled = true;

  window.HobunjiAnimalHeadRigPreviewLookup = {
    version: 1,
    resolveForKind: kind => renderer.headRigForKind(kind),
  }; // Small mobile/debug-visible proof that explicit callers use preview-aware resolution.
})();
