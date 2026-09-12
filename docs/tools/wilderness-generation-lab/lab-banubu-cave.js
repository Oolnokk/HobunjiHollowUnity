(() => {
  'use strict';

  const Generator = window.WildernessMapGenerator;
  const Preview = window.WildernessLabPreview;
  const TerrainPreview = window.TerrainPreview;
  const THREE = window.THREE;
  if (!Generator || !Preview || !TerrainPreview || !THREE || window.__wildernessLabBanubuCaveInstalled) return;
  window.__wildernessLabBanubuCaveInstalled = true;

  const BANUBU_LOCALE_ID = 'locale_banubu_shrine';
  const params = new URLSearchParams(location.search);
  const state = {
    enabled: params.get('banubuCave') === '1',
    definition: null,
  }; // Query opt-in keeps the general Lab unchanged; the checkbox can enable the live cave in any session.

  let currentGroup = null; // Live Banubu cave + NPC visuals are detached before each regenerated preview.
  let attachToken = 0; // Rejects stale asynchronous GLB/texture loads after regeneration.
  let loaderPromise = null; // Loads the game's checked-in r128 GLTFLoader only when the cave preview is used.
  let caveTemplatePromise = null; // Shared cave_small.glb mesh template.
  let caveMaterial = null; // Shared carved_smooth material, matching the game's den/cavern cave style.
  let grehlrTexturePromise = null; // Banubu's actual Grehlr idle sprite texture.

  function requestGenerate() {
    const button = document.getElementById('generateBtn');
    if (button && !button.disabled) button.click();
  }

  async function loadDefinition() {
    try {
      const response = await fetch('../../config/locales/locale_banubu_shrine.json', { cache: 'no-store' }); // Repo locale is the source of truth for both placement and live visual metadata.
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.definition = await response.json();
      updateStatus();
      if (state.enabled) {
        applyNorthernCliffsRecipeOnce();
        requestGenerate();
      }
    } catch (error) {
      console.warn('[WildernessLab] Banubu cave definition failed to load:', error);
      updateStatus(`Banubu locale load failed: ${error.message}`);
    }
  }

  function applyNorthernCliffsRecipeOnce() {
    if (!state.enabled || window.__banubuCaveRecipeApplied) return;
    const select = document.getElementById('recipeSelect');
    const button = document.getElementById('applyRecipeBtn');
    if (!select || !button) return;
    window.__banubuCaveRecipeApplied = true;
    select.value = 'northernCliffs';
    button.click(); // Uses the Lab's own recipe wiring so every related terrain control stays synchronized.
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
        <div class="help" style="margin-top:6px">Uses the repo locale, its real plateau carve, the game's <code>cave_small.glb</code> with carved-stone material at 2× normal cave scale, and Banubu's actual Grehlr idle sprite.</div>
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
    node.textContent = `${state.enabled ? 'Enabled' : 'Disabled'} · Northern Cliffs only · ${embedded} embedded cave cells · entrance visual ×${state.definition.objects?.[0]?.visual?.scale || 2}`;
  }

  const previousGenerateWorkspace = Generator.generateWorkspace.bind(Generator); // Wraps after generic locale diagnostics so this repo locale can be previewed without a manual import.
  Generator.generateWorkspace = function banubuCaveGenerateWorkspace(seed, settings = {}) {
    if (!state.enabled || !state.definition) return previousGenerateWorkspace(seed, settings);
    const existing = Array.isArray(settings.locales) ? settings.locales : [];
    const locales = existing.some(locale => locale?.id === BANUBU_LOCALE_ID) ? existing : [...existing, state.definition];
    return previousGenerateWorkspace(seed, { ...settings, locales });
  };

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

  function ensureLoader() {
    if (THREE.GLTFLoader) return Promise.resolve(THREE.GLTFLoader);
    if (loaderPromise) return loaderPromise;
    loaderPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script'); // Same local GLTFLoader used by docs/index.html; no alternate Three version is introduced.
      script.src = '../../js/GLTFLoader.js';
      script.onload = () => THREE.GLTFLoader ? resolve(THREE.GLTFLoader) : reject(new Error('GLTFLoader did not register'));
      script.onerror = () => reject(new Error('GLTFLoader.js failed to load'));
      document.head.appendChild(script);
    });
    return loaderPromise;
  }

  function assignCaveUv(geometry) {
    if (geometry?.getAttribute?.('uv')) return;
    const pos = geometry?.getAttribute?.('position');
    if (!pos) return;
    const uv = new Float32Array(pos.count * 2); // Exact raw-XZ planar fallback used by zone-den-totem-features.js for cave_small.glb.
    for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i); uv[i * 2 + 1] = pos.getZ(i); }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  function loadCaveTemplate() {
    if (caveTemplatePromise) return caveTemplatePromise;
    caveTemplatePromise = ensureLoader().then(() => new Promise(resolve => {
      new THREE.GLTFLoader().load('../../assets/models/cave_small.glb', gltf => {
        const root = gltf.scene || gltf.scenes?.[0];
        const mesh = root?.isMesh ? root : root?.getObjectByProperty?.('isMesh', true) || root?.children?.find(child => child.isMesh);
        if (!mesh) { resolve(null); return; }
        assignCaveUv(mesh.geometry);
        mesh.geometry.computeBoundingBox();
        resolve(mesh);
      }, undefined, error => { console.warn('[WildernessLab] cave_small.glb load failed:', error); resolve(null); });
    })).catch(error => { console.warn('[WildernessLab] cave loader unavailable:', error); return null; });
    return caveTemplatePromise;
  }

  function caveMaterialFor() {
    if (caveMaterial) return caveMaterial;
    const texture = new THREE.TextureLoader().load('../../assets/textures/carved_smooth.png');
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(0.35, 0.35); // Same repeat as the game cave entrance/cavern continuity material.
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    caveMaterial = new THREE.MeshLambertMaterial({ color: 0x808080, map: texture, side: THREE.DoubleSide });
    return caveMaterial;
  }

  function loadGrehlrTexture() {
    if (grehlrTexturePromise) return grehlrTexturePromise;
    grehlrTexturePromise = new Promise(resolve => {
      new THREE.TextureLoader().load('../../assets/creaturesprites/grehlr_idle.png', texture => {
        if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
        resolve(texture);
      }, undefined, error => { console.warn('[WildernessLab] Banubu sprite load failed:', error); resolve(null); });
    });
    return grehlrTexturePromise;
  }

  async function buildLiveGroup(workspace, merged, token) {
    const group = new THREE.Group();
    group.name = 'banubu_cave_live_preview';
    if (!state.enabled || token !== attachToken) return group;
    const instance = (workspace?.localeInstances || []).find(locale => locale?.localeId === BANUBU_LOCALE_ID);
    if (!instance) return group;

    const sourceObject = state.definition?.objects?.find(object => object.key === 'cave_small') || state.definition?.objects?.[0];
    const placedObject = (instance.objects || []).find(object => object.id === sourceObject?.id) || instance.objects?.[0];
    const template = await loadCaveTemplate();
    if (template && placedObject && token === attachToken) {
      const box = template.geometry.boundingBox;
      const templateSpan = Math.max(1e-4, box.max.x - box.min.x, box.max.z - box.min.z);
      const footprint = Math.max(1, Math.min(Number(placedObject.w) || 1, Number(placedObject.h) || 1));
      const authoredVisualScale = Number(sourceObject?.visual?.scale) || 2;
      const scale = (footprint / templateSpan) * 0.5 * authoredVisualScale; // Game den prop is 0.5× footprint; authored 2× restores a full-footprint cave mouth.
      const x = Number(placedObject.x) + (Number(placedObject.w) || 1) * 0.5;
      const z = Number(placedObject.y) + (Number(placedObject.h) || 1) * 0.5;
      const mesh = template.clone();
      mesh.material = caveMaterialFor();
      mesh.scale.setScalar(scale);
      mesh.rotation.y = Math.PI; // Banubu's authored connector is north; cave_small's normal mouth faces south.
      mesh.position.set(x, surfaceY(merged, x, z) - 0.35 - box.min.y * scale, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'banubu_cave_small_live';
      group.add(mesh);
    }

    const banubu = (instance.npcAnchors || []).find(anchor => anchor.npcId === 'banubu');
    const texture = banubu ? await loadGrehlrTexture() : null;
    if (banubu && texture && token === attachToken) {
      const width = 2.2; // Grehlr modelWidth mirrored from the game's creature database.
      const height = width / 0.75; // Grehlr idle sprite aspect mirrored by hobunji-creature-bestiary.json.
      const x = Number(banubu.x) + 0.5;
      const z = Number(banubu.y) + 0.5;
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, alphaTest: 0.025, depthWrite: false });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(width, height, 1);
      sprite.position.set(x, surfaceY(merged, x, z) + height * 0.5, z);
      sprite.name = 'banubu_live_grehlr';
      group.add(sprite);
    }
    return group;
  }

  function disposeCurrent() {
    attachToken++;
    if (!currentGroup) return;
    currentGroup.parent?.remove(currentGroup);
    currentGroup.traverse(node => {
      if (node.isSprite && node.material) node.material.dispose?.(); // Cave template/material are shared caches; only per-render sprite material is disposable.
    });
    currentGroup = null;
  }

  function attach(group, token, attempts = 0) {
    if (token !== attachToken) return;
    const scene = [...(window.__wildernessLabScenes || [])][0];
    if (!scene) {
      if (attempts < 30) requestAnimationFrame(() => attach(group, token, attempts + 1));
      return;
    }
    currentGroup = group;
    scene.add(group);
  }

  const previousRenderWorkspace = Preview.renderWorkspace.bind(Preview);
  Preview.renderWorkspace = (workspace, rootId, winterSettings) => {
    disposeCurrent();
    const merged = previousRenderWorkspace(workspace, rootId, winterSettings);
    const token = attachToken;
    buildLiveGroup(workspace, merged, token).then(group => {
      if (token !== attachToken) return;
      attach(group, token);
    });
    const diagnostic = (workspace?.localeTerrainDiagnostics || []).find(item => item.localeId === BANUBU_LOCALE_ID);
    if (diagnostic) updateStatus(diagnostic.status === 'placed'
      ? `Placed · ${diagnostic.valid} valid cliff sites · floor tier ${diagnostic.selected?.floorTier ?? 0} · live cave + Banubu rendered`
      : `No placement · ${diagnostic.reason || 'no matching plateau cliff'}`);
    return merged;
  };

  installControls();
  loadDefinition();
  console.log('[WildernessLab] Banubu Cave repo placement + in-game-style live renderer loaded');
})();
