// Random Test Ruin cross-layer runtime coverage resolver.
// Batch 1 intentionally audits V50 tags before later modules know what they own.
// This module reconciles those raw findings against Batch 2 hit logic and Batch 3
// scene-parent/motion logic so the dev badge and multi-seed audit report actual
// missing runtime behavior rather than objects already handled by another layer.
(() => {
  'use strict';

  const DS = window.DynamicSurfaces;
  const MAP_ID = 'map_i_dev_random_ruin';
  if (!DS) return;

  function activeRoot() {
    if (window.GridTileAccessors?.getCurrentArea?.() !== MAP_ID) return null;
    const scene = window.GridTileAccessors?.getActiveScene?.();
    return scene?.children?.find?.(object => /^dev_v50_ruin_/.test(object?.name || '')) || null;
  }

  let indexedRoot = null; // Root the name index below was built from; rebuilt only when the root changes instead of retraversing per audit entry, per frame.
  let nameIndex = null;
  function indexFor(root) {
    if (!root) { indexedRoot = null; nameIndex = null; return null; }
    if (root === indexedRoot && nameIndex) return nameIndex;
    nameIndex = new Map();
    root.traverse?.(object => {
      const auditName = object.name || `object-${object.id}`;
      if (!nameIndex.has(auditName)) nameIndex.set(auditName, object);
    });
    indexedRoot = root;
    return nameIndex;
  }

  function objectForAuditEntry(root, entry) {
    if (!root || !entry?.objectName) return null;
    return indexFor(root)?.get(entry.objectName) || null;
  }

  function resolveCoverage() {
    const rawSnapshot = window.DevRandomRuinPrototypeHooks?.snapshot?.() || null;
    const rawUnhandled = rawSnapshot?.audit?.unhandled || [];
    const hit = window.DevRandomRuinHitPuzzles?.snapshot?.() || null;
    const root = activeRoot();
    const alwaysLitEntries = rawUnhandled.filter(entry => entry.activatorType === 'alwaysLitTorch');
    // Batch 2 discovers one torch source per V50 always-lit reference torch. Requiring
    // at least the same count keeps this from hiding a future source-discovery regression.
    const hitOwnsReferenceTorches = !!(hit?.active && Number(hit.torchSources) >= alwaysLitEntries.length);
    const covered = [];
    const effectiveUnhandled = [];

    for (const entry of rawUnhandled) {
      const object = objectForAuditEntry(root, entry);
      const data = object?.userData || {};
      let handledBy = null;
      if (entry.activatorType === 'alwaysLitTorch' && data.alwaysLit && hitOwnsReferenceTorches) {
        handledBy = 'batch2-hit-runtime:timed-torch-fuel-source';
      } else if (data.groundedToMovingPlatform && object?.parent) {
        // V50 attaches these display groups directly beneath the moving platform;
        // their world transform therefore follows the platform without another rider adapter.
        handledBy = 'three-parent-transform:moving-platform-display';
      }
      if (handledBy) covered.push({ entry:{...entry}, handledBy, objectId:object?.id ?? null });
      else effectiveUnhandled.push({ ...entry });
    }

    return {
      active:!!root,
      rootName:root?.name || null,
      rawUnhandled:rawUnhandled.map(entry => ({...entry})),
      covered,
      effectiveUnhandled,
      torchSourceCoverage:{
        alwaysLitReferences:alwaysLitEntries.length,
        registeredTorchSources:Number(hit?.torchSources) || 0,
        complete:hitOwnsReferenceTorches,
      },
    };
  }

  function updateBadge() {
    if (window.GridTileAccessors?.getCurrentArea?.() !== MAP_ID) return null; // Frame client runs for every player; skip the snapshot/JSON clone work outside the dev ruin.
    const badge = document.getElementById('devRandomRuinBadge');
    if (!badge) return null;
    const coverage = resolveCoverage();
    if (!coverage.active) return coverage;
    let text = badge.textContent.replace(/ · cross-layer \d+$/, '');
    text = text.replace(/unhandled \d+/, `unhandled ${coverage.effectiveUnhandled.length}`);
    if (coverage.covered.length) text += ` · cross-layer ${coverage.covered.length}`;
    badge.textContent = text;
    return coverage;
  }

  function filterSeedAudit(result) {
    if (!result) return result;
    const isCrossLayerKnown = entry => entry?.kind === 'activator' && entry?.value === 'alwaysLitTorch';
    for (const row of result.results || []) {
      if (Array.isArray(row.unknown)) row.unknown = row.unknown.filter(entry => !isCrossLayerKnown(entry));
      if (Array.isArray(row.activators) && row.activators.includes('alwaysLitTorch')) {
        row.crossLayerKnown = [...(row.crossLayerKnown || []), 'alwaysLitTorch→batch2-hit-runtime'];
      }
    }
    if (result.aggregate) {
      result.aggregate.unknown = (result.aggregate.unknown || []).filter(entry => !isCrossLayerKnown(entry));
      if ((result.aggregate.activators || []).includes('alwaysLitTorch')) {
        result.aggregate.crossLayerKnown = [...(result.aggregate.crossLayerKnown || []), 'alwaysLitTorch→batch2-hit-runtime'];
      }
    }
    return result;
  }

  async function auditSeeds(count = 12) {
    const result = await window.DevRandomRuinMotionRuntime?.auditSeeds?.(count);
    return filterSeedAudit(result);
  }

  DS.addBeforeRenderClient(updateBadge);

  window.DevRandomRuinRuntimeCoverage = Object.freeze({
    snapshot:resolveCoverage,
    auditSeeds,
    filterSeedAudit,
  });
})();
