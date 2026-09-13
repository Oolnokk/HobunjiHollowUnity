(() => {
  'use strict';

  // Replaces this lab's old standalone "winter" preview (lab-preview.js's
  // own hand-rolled rebuildWinter — its own geometry/shader uniforms, never
  // connected to anything the real game ships) with the actual live
  // system: window.EnvironmentSurfaceMicroPlateau, the same module that
  // renders Western Slope snow and Coldmuck slush in the real game. This
  // makes the "Preview Western snowpack"/"Preview Coldmuck slush" buttons
  // an accurate preview instead of an independent guess that can (and did)
  // drift out of sync with what actually ships.
  const Preview = window.WildernessLabPreview;
  if (!Preview || Preview.__realEnvironmentSurfaceInstalled) return;
  Preview.__realEnvironmentSurfaceInstalled = true;

  // The real module reads the world through window.GridTileAccessors /
  // window.CalendarSystem — this lab has neither (it's a standalone tool),
  // so this stands in for both, driven by the existing winterEnabled/
  // winterPreset controls instead of a real area/season.
  let overrideArea = '';
  let overrideSeason = 'Deadgrass';
  let shimGrid = null; // { zGrid, cols, rows } rebuilt from the lab's own merged workspace after every render.

  window.GridTileAccessors = {
    getCurrentArea: () => overrideArea,
    getActiveScene: () => [...(window.__wildernessLabScenes || [])][0] || null,
    getActiveGrid: () => shimGrid?.zGrid || null,
    getActiveCols: () => shimGrid?.cols || 0,
    getActiveRows: () => shimGrid?.rows || 0,
  };
  window.CalendarSystem = { currentSeason: () => ({ name: overrideSeason }) };

  function applyOverridesFromUi() {
    const enabled = !!document.getElementById('winterEnabled')?.checked;
    const preset = document.getElementById('winterPreset')?.value;
    if (!enabled) { overrideArea = ''; overrideSeason = 'Deadgrass'; return; }
    if (preset === 'snow') { overrideArea = 'map_western_slope'; overrideSeason = 'Deadgrass'; }
    else if (preset === 'slush') { overrideArea = 'farm'; overrideSeason = 'Coldmuck'; }
    else { overrideArea = ''; overrideSeason = 'Deadgrass'; }
  }

  // TerrainPreview.buildZGrid is the exact same dense-grid builder
  // buildTerrainRoot already used to build the visible terrain, so tile
  // height here always matches what's actually on screen.
  function rebuildShimGrid() {
    const merged = Preview.getMerged?.();
    const TerrainPreview = window.TerrainPreview;
    shimGrid = (merged && TerrainPreview)
      ? { zGrid: TerrainPreview.buildZGrid(merged.cols, merged.rows, merged.tiles), cols: merged.cols, rows: merged.rows }
      : null;
  }

  function refresh() {
    applyOverridesFromUi();
    rebuildShimGrid();
    // forceRebuild() only tears down an existing build when a surface is
    // actually still active; if the layer just got disabled, the real
    // module's own tick() loop notices the mode went to 'none' and cleans
    // up on its very next frame regardless.
    window.EnvironmentSurfaceMicroPlateau?.forceRebuild?.();
    // Cosmetic Deadgrass desaturation tint from the old preview is
    // orthogonal to which system builds the slush overlay geometry, so
    // it's kept here rather than lost along with that old system.
    if (overrideSeason === 'Coldmuck' && overrideArea) Preview.__applyColdmuckGroundLook?.();
    else Preview.__clearColdmuckGroundLook?.();
  }

  // A new seed regenerates the whole workspace with new grid data that the
  // running overlay has no way to detect on its own (same scene, same
  // area/mode as before) — refresh after every render, not just once.
  const previousRenderWorkspace = Preview.renderWorkspace.bind(Preview);
  Preview.renderWorkspace = (workspace, rootId) => {
    // The old winter mesh generation this replaces lived behind the third
    // argument (environmentSettings) — passing null retires it for good
    // rather than leaving it to run alongside the real module.
    const result = previousRenderWorkspace(workspace, rootId, null);
    refresh();
    return result;
  };

  // index.html's own inline script also calls Preview.rebuildWinter(...)
  // directly — outside renderWorkspace entirely — from every winter-section
  // slider/dropdown listener (accumulation depth, opacity, lump scale,
  // layer bulge, target material, edge wrap, and the enabled/preset
  // controls themselves), and lab-terrain-skin.js/lab-features.js call it
  // again mid-generation after reclassifying tiles. Replacing the function
  // itself catches all of those existing callers in one place instead of
  // requiring each one to be found and edited individually; none of them
  // depend on its return value or the (now-irrelevant) settings argument
  // they pass in, since the real overlay only reads winterEnabled/
  // winterPreset off the DOM.
  Preview.rebuildWinter = refresh;
})();
