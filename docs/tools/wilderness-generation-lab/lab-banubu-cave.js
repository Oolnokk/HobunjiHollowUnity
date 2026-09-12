(() => {
  'use strict';

  const Generator = window.WildernessMapGenerator;
  const Preview = window.WildernessLabPreview;
  const TerrainPreview = window.TerrainPreview;
  const CaveRuntime = window.LocaleCaveRuntime;
  const ZoneFeatures = window.ZoneDenTotemFeatures;
  const THREE = window.THREE;
  if (!Generator || !Preview || !TerrainPreview || !CaveRuntime || !ZoneFeatures || !THREE || window.__wildernessLabBanubuCaveInstalled) return;
  window.__wildernessLabBanubuCaveInstalled = true;

  const BANUBU_LOCALE_ID = 'locale_banubu_shrine';
  const LAB_CAVE_MAP_ID = 'wilderness_lab_banubu_cave';
  const state = {
    enabled: new URLSearchParams(location.search).get('banubuCave') === '1',
    definition: null,
  }; // Query opt-in opens a direct Banubu test; the checkbox can enable it in any Lab session.
  let grehlrTexturePromise = null; // Actual Banubu/Grehlr idle sprite used by the live preview.

  function requestGenerate() {
    const button = document.getElementById('generateBtn');
    if (button && !button.disabled) button.click();
  }

  function applyNorthernCliffsRecipeOnce() {
    if (!state.enabled || window.__banubuCaveRecipeApplied) return;
    const select = document.getElementById('recipeSelect');
    const button = document.getElementById('applyRecipeBtn');
    if (!select || !button) return;
    window.__banubuCaveRecipeApplied = true;
    select.value = 'northernCliffs';
    button.click(); // Uses the Lab's own recipe machinery so every Northern Cliffs setting changes together.
  }

  async function loadDefinition() {
    try {
      const response = await fetch('../../config/locales/locale_banubu_shrine.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.definition = await response.json();
      updateStatus();
      if (state.enabled) {
        applyNorthernCliffsRecipeOnce();
        requestGenerate();
      }
    } catch (error) {
      console.warn('[WildernessLab] Banubu Cave locale failed to load:', error);
      updateStatus(`Locale load failed: ${error.message}`);
    }
  }

  function installControls() {
    const sidebar = document.querySelector('aside .sidebar-scroll') || document.querySelector('aside');
    if (!sidebar || document.getElementById('banubuCaveLiveCard')) return;
    const panel = document.createElement('details');
    panel.id = 'banubuCaveLiveCard';
    panel.className = 'card';
    panel.open = state.enabled;
    panel.innerHTML = `
      <summary>Banubu's Cave live preview</summary>
      <div class="card-body">
        <label style="display:flex;gap:6px;align-items:center"><input id="banubuCaveEnabled" type="checkbox" ${state.enabled ? 'checked' : ''} style="width:auto"> Place Banubu's Cave</label>
        <div class="help" style="margin-top:6px">Uses the repo locale and real plateau carve. The cave mouth is rendered by <code>ZoneDenTotemFeatures.buildAnimalDenMeshes</code> — the same <code>cave_small.glb</code>, UVs, material, sink, shadow flags, and scale math used in-game. Banubu uses his Grehlr idle sprite.</div>
        <div id="banubuCaveStatus" class="help" style="margin-top:6px">Loading locale…</div>
      </div>`;
    sidebar.appendChild(panel);
    document.getElementById('banubuCaveEnabled').addEventListener('change', event => {
      state.enabled = !!event.target.checked;
      if (state.enabled) applyNorthernCliffsRecipeOnce();
      requestGenerate();
      updateStatus();
    });
  }

  function updateStatus(message = '') {
    const node = document.getElementById('banubuCaveStatus');
    if (!node) return;
    if (message) { node.textContent = message; return; }
    if (!state.definition) { node.textContent = 'Loading locale…'; return; }
    const embedded = Object.keys(state.definition.embeddedTiles || {}).length;
    const scale = state.definition.objects?.find(object => object.key === 'cave_small')?.visual?.scale || 2;
    node.textContent = `${state.enabled ? 'Enabled' : 'Disabled'} · Northern Cliffs only · ${embedded} embedded cells · game cave renderer ×${scale}`;
  }

  const previousGenerateWorkspace = Generator.generateWorkspace.bind(Generator);
  Generator.generateWorkspace = function banubuCaveGenerateWorkspace(seed, settings = {}) {
    if (!state.enabled || !state.definition) return previousGenerateWorkspace(seed, settings);
    const existing = Array.isArray(settings.locales) ? settings.locales : [];
    const locales = existing.some(locale => locale?.id === BANUBU_LOCALE_ID) ? existing : [...existing, state.definition];
    return previousGenerateWorkspace(seed, { ...settings, locales });
  };

  function mergedZGrid(merged) {
    const rows = Array.from({ length: merged.rows }, () => Array.from({ length: merged.cols }, () => null));
    for (let r = 0; r < merged.rows; r++) {
      for (let c = 0; c < merged.cols; c++) rows[r][c] = merged.tiles.get(`${c},${r}`) || null;
    }
    return rows;
  }

  function currentScene() {
    const scenes = [...(window.__wildernessLabScenes || [])];
    return scenes.length ? scenes[scenes.length - 1] : null;
  }

  function surfaceY(merged, x, z) {
    const c = Math.max(0, Math.min(merged.cols - 1, Math.floor(x)));
    const r = Math.max(0, Math.min(merged.rows - 1, Math.floor(z)));
    const tile = merged.tiles.get(`${c},${r}`);
    let y = TerrainPreview.NORMAL_TOP || 0;
    if (tile?.type === 'ramp') y += (Number(tile.rampElevation) || 0) * TerrainPreview.PLATEAU_UNIT;
    else y += (Number(tile?.elevTier) || 0) * TerrainPreview.PLATEAU_UNIT;
    y += TerrainPreview.sampleVisualHeight?.(merged.visualHeights, x, z, merged.cols, merged.rows) || 0;
    return y;
  }

  function loadGrehlrTexture() {
    if (grehlrTexturePromise) return grehlrTexturePromise;
    grehlrTexturePromise = new Promise(resolve => {
      new THREE.TextureLoader().load('../../assets/creaturesprites/grehlr_idle.png', texture => {
        if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
        resolve(texture);
      }, undefined, error => {
        console.warn('[WildernessLab] Banubu Grehlr sprite failed to load:', error);
        resolve(null);
      });
    });
    return grehlrTexturePromise;
  }

  async function renderBanubuNpc(scene, merged, instance) {
    const anchor = (instance?.npcAnchors || []).find(item => item.npcId === 'banubu');
    if (!anchor || !scene) return;
    const texture = await loadGrehlrTexture();
    if (!texture || (!scene.parent && !window.__wildernessLabScenes?.has?.(scene))) return;
    const width = 2.2; // Grehlr modelWidth from hobunji-creature-bestiary.json.
    const height = width / 0.75; // Grehlr idle spriteAspect from the same bestiary entry.
    const x = Number(anchor.x) + 0.5;
    const z = Number(anchor.y) + 0.5;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, alphaTest: 0.025, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.name = 'banubu_live_grehlr';
    sprite.scale.set(width, height, 1);
    sprite.position.set(x, surfaceY(merged, x, z) + height * 0.5, z);
    sprite.userData.npcId = 'banubu';
    scene.add(sprite);
  }

  function renderExactGameCave(scene, merged, workspace) {
    if (!scene || !state.definition) return;
    CaveRuntime.registerWorkspace(LAB_CAVE_MAP_ID, workspace, [state.definition]); // Same registry populated automatically by generateZoneWorkspace in the game.
    ZoneFeatures.init({
      NORMAL_TOP: TerrainPreview.NORMAL_TOP,
      PLATEAU_UNIT: TerrainPreview.PLATEAU_UNIT,
      markOutline: () => {}, // Gameplay's target-outline compositor is not part of the standalone Lab; geometry/material/shadows are otherwise the exact runtime path.
    });
    ZoneFeatures.buildAnimalDenMeshes(scene, mergedZGrid(merged), [], LAB_CAVE_MAP_ID);
  }

  const previousRenderWorkspace = Preview.renderWorkspace.bind(Preview);
  Preview.renderWorkspace = (workspace, rootId, winterSettings) => {
    const merged = previousRenderWorkspace(workspace, rootId, winterSettings);
    if (state.enabled && state.definition) {
      const instance = (workspace?.localeInstances || []).find(locale => locale?.localeId === BANUBU_LOCALE_ID);
      const scene = currentScene();
      if (instance && scene) {
        renderExactGameCave(scene, merged, workspace);
        renderBanubuNpc(scene, merged, instance);
      }
      const diagnostic = (workspace?.localeTerrainDiagnostics || []).find(item => item.localeId === BANUBU_LOCALE_ID);
      updateStatus(diagnostic?.status === 'placed'
        ? `Placed · ${diagnostic.valid} valid sites · floor tier ${diagnostic.selected?.floorTier ?? 0} · exact game cave renderer + Banubu visible`
        : `No placement · ${diagnostic?.reason || 'no matching plateau host'}`);
    }
    return merged;
  };

  installControls();
  loadDefinition();
  console.log('[WildernessLab] Banubu Cave exact game-render path loaded');
})();
