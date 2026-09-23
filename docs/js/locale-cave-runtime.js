// Locale cave registry shared by generated wilderness runtime and preview tools.
// Terrain-aware locale placement owns where a cave sits; this bridge remembers
// cave_small objects from the authored locale definition so the ordinary zone
// cave renderer can draw them with exactly the same mesh/material path as dens.
(() => {
  'use strict';

  if (window.LocaleCaveRuntime) return;

  const cavesByMapId = new Map(); // mapId -> placed locale cave records consumed by ZoneDenTotemFeatures.

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

  function caveObjectDefinition(object) {
    return !!object && (object.key === 'cave_small' || object.visual?.renderer === 'cave_small');
  }

  function registerWorkspace(mapId, workspace, localeDefinitions = [], foldedTiles = null) {
    const defs = new Map((localeDefinitions || []).filter(Boolean).map(locale => [locale.id, locale]));
    const caves = [];
    for (const instance of workspace?.localeInstances || []) {
      const locale = defs.get(instance?.localeId);
      const entrance = instance.connectors?.[0]; // Low-side connector is the reliable floor tier when the cave overlaps high cliff cells.
      const entranceTile = entrance && foldedTiles?.get?.(`${entrance.x},${entrance.y}`);
      const floorTier = instance.floorTier != null && Number.isFinite(Number(instance.floorTier))
        ? Number(instance.floorTier)
        : Number.isFinite(Number(entranceTile?.elevTier)) && entranceTile
          ? Number(entranceTile.elevTier) : null;
      // Cached Tothal workspaces retain placed objects but do not rerun the generator capture.
      const sourceById = new Map((locale?.objects || []).map(object => [object.id, object]));
      for (const placed of instance.objects || []) {
        const source = sourceById.get(placed.id);
        if (!caveObjectDefinition(source) && !caveObjectDefinition(placed)) continue;
        caves.push({
          ...clone(placed),
          localeId: instance.localeId,
          localeName: instance.name || locale?.name || instance.localeId,
          floorTier, // The low-side connector, rather than the high rear plateau or an absent value coerced to zero, anchors the facade.
          visual: clone(source?.visual || placed.visual || { renderer: 'cave_small', scale: 1 }),
          sourceObjectId: source?.id || placed.id,
        });
      }
    }
    cavesByMapId.set(String(mapId || ''), caves);
    return caves;
  }

  function cavesForZone(mapId) {
    return clone(cavesByMapId.get(String(mapId || '')) || []);
  }

  function clearZone(mapId) {
    cavesByMapId.delete(String(mapId || ''));
  }

  function installGeneratorCapture() {
    const generator = window.WildernessMapGenerator;
    if (!generator || generator.__localeCaveRuntimeCaptureInstalled) return;
    generator.__localeCaveRuntimeCaptureInstalled = true;
    const previousGenerateZoneWorkspace = generator.generateZoneWorkspace?.bind(generator);
    if (!previousGenerateZoneWorkspace) return;
    generator.generateZoneWorkspace = function localeCaveGenerateZoneWorkspace(zoneMapId, seedText, locales = []) {
      const workspace = previousGenerateZoneWorkspace(zoneMapId, seedText, locales);
      registerWorkspace(zoneMapId, workspace, locales);
      return workspace;
    };
  }

  window.LocaleCaveRuntime = {
    registerWorkspace,
    cavesForZone,
    clearZone,
    caveObjectDefinition,
  };

  installGeneratorCapture();
})();
