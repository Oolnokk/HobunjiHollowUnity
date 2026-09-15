from pathlib import Path

path = Path('docs/js/seat-surface-placement-transform.js')
source = path.read_text()

if 'visualAuthoredBuilds: 0' not in source:
    needle = '    boundStationsTransformed: 0,\n'
    replacement = '''    boundStationsTransformed: 0,
    visualAuthoredBuilds: 0,
    visualAsyncUpgrades: 0,
    visualUpgradeDelegations: 0,
    visualUpgradeFailures: 0,
    lastVisualBaseKey: null,
    lastVisualError: null,
'''
    if needle not in source:
        raise SystemExit('state insertion anchor not found')
    source = source.replace(needle, replacement, 1)

start = source.index('  function installVisualAliasBridge() {')
end = source.index('  function installMapLayoutBridge() {', start)
new_function = r'''  function installVisualAliasBridge() {
    const furniture = window.ProceduralFurniture; // Used as the common furniture visual entry point that game.js calls for runtime seat aliases.
    const originalBuilder = furniture?.buildFurnitureGroup; // Used only for the ordinary base-key fallback while authored JSON is still loading.
    if (!furniture || typeof originalBuilder !== 'function' || originalBuilder.__seatSurfacePlacementWrapped) return;

    function markAuthoredAliasVisual(group, record, source) {
      if (!group) return group;
      group.userData = group.userData || {};
      Object.assign(group.userData, {
        seatSurfaceAliasKey: record.aliasKey,
        seatSurfaceVisualBaseKey: record.baseKey,
        authoredFurnitureKey: record.baseKey,
        authoredFurnitureUpgraded: true,
        authoredFurnitureUpgradeSource: source,
        pendingAuthoredFurnitureKey: null,
        authoredFurnitureFallback: false,
      });
      state.lastVisualBaseKey = record.baseKey;
      return group;
    }

    function disposeSeatFallback(root) {
      root?.traverse?.((object) => {
        object.geometry?.dispose?.();
        for (const material of (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean)) {
          material.dispose?.();
        }
      });
    }

    function adoptAuthoredAliasVisual(target, fallbackChildren, data, baseColor, record) {
      const authored = window.AuthoredFurniture; // Re-read at upgrade time so later authored-runtime wrappers remain part of the rendered result.
      if (!target || !data || typeof authored?.buildGroup !== 'function') return false;
      const replacement = authored.buildGroup(data, baseColor); // Builds the real authored chair/bench rather than the procedural brown placeholder.
      if (!replacement) return false;

      for (const child of fallbackChildren) {
        if (child?.parent !== target) continue;
        target.remove?.(child);
        disposeSeatFallback(child);
      }
      for (const child of [...(replacement.children || [])]) target.add?.(child);
      target.name = replacement.name || target.name;
      Object.assign(target.userData || (target.userData = {}), replacement.userData || {});
      markAuthoredAliasVisual(target, record, 'seat-alias-async-upgrade');
      target.updateMatrixWorld?.(true);
      state.visualAsyncUpgrades += 1;
      return true;
    }

    function buildFurnitureGroupWithSeatAlias(furnitureKey, ...args) {
      const record = aliasByKey.get(String(furnitureKey || '')); // Synthetic aliases affect seat metadata only; visuals always resolve through the real base furniture key/data.
      if (!record) return originalBuilder.call(this, furnitureKey, ...args);

      const authored = window.AuthoredFurniture; // Looked up live so script load order cannot strand aliases on the pre-authored procedural builder.
      const baseColor = args[0]; // Preserves the ordinary furniture builder's optional tint when constructing authored parts.
      const cached = authored?.peek?.(record.baseKey); // Uses the real key: the alias has no JSON file and must never enter the visual asset lookup.
      if (cached && typeof authored?.buildGroup === 'function') {
        const ready = authored.buildGroup(cached, baseColor);
        if (ready) {
          state.visualAuthoredBuilds += 1;
          return markAuthoredAliasVisual(ready, record, 'seat-alias-ready-at-build');
        }
      }

      const group = originalBuilder.call(this, record.baseKey, ...args); // Temporary fallback uses the real key so even older procedural catalogs never see the alias.
      if (!group) return group;
      group.userData = group.userData || {};
      group.userData.seatSurfaceAliasKey = record.aliasKey;
      group.userData.seatSurfaceVisualBaseKey = record.baseKey;
      state.lastVisualBaseKey = record.baseKey;

      if (group.userData.authoredFurnitureImported || group.userData.authoredFurnitureUpgraded) {
        state.visualAuthoredBuilds += 1;
        return markAuthoredAliasVisual(group, record, group.userData.authoredFurnitureUpgradeSource || 'seat-alias-delegated-ready');
      }

      if (group.userData.pendingAuthoredFurnitureKey === record.baseKey) {
        state.visualUpgradeDelegations += 1;
        return group; // FurnitureVesselRuntime already owns this exact in-place upgrade; scheduling another would race child disposal.
      }

      if (typeof authored?.load !== 'function' || typeof authored?.buildGroup !== 'function') {
        state.visualUpgradeFailures += 1;
        state.lastVisualError = `missing AuthoredFurniture loader/builder for ${record.baseKey}`;
        return group;
      }

      const fallbackChildren = [...(group.children || [])]; // Only these temporary brown-placeholder children are removed when the authored data arrives.
      group.userData.pendingAuthoredFurnitureKey = record.baseKey;
      group.userData.authoredFurnitureFallback = true;
      Promise.resolve(authored.load(record.baseKey))
        .then((data) => {
          if (!data) {
            group.userData.pendingAuthoredFurnitureKey = null;
            group.userData.authoredFurnitureFallbackMissing = true;
            state.visualUpgradeFailures += 1;
            state.lastVisualError = `missing authored furniture data for ${record.baseKey}`;
            return;
          }
          adoptAuthoredAliasVisual(group, fallbackChildren, data, baseColor, record);
        })
        .catch((error) => {
          group.userData.pendingAuthoredFurnitureKey = null;
          group.userData.authoredFurnitureFallbackError = String(error?.message || error || 'load failed');
          state.visualUpgradeFailures += 1;
          state.lastVisualError = group.userData.authoredFurnitureFallbackError;
        });
      return group;
    }

    Object.assign(buildFurnitureGroupWithSeatAlias, originalBuilder);
    buildFurnitureGroupWithSeatAlias.__seatSurfacePlacementWrapped = true;
    buildFurnitureGroupWithSeatAlias.__seatSurfacePlacementOriginal = originalBuilder;
    furniture.buildFurnitureGroup = buildFurnitureGroupWithSeatAlias;
  }

'''
source = source[:start] + new_function + source[end:]
path.write_text(source)
