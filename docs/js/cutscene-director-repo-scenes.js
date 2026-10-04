(() => {
  'use strict';

  if (!/\/tools\/cutscene-director\//.test(location.pathname)) return;

  const REPO_SCENES = Object.freeze([
    Object.freeze({ id: 'opening-rescue', label: 'Opening — Cloud Forest Rescue', builder: 'buildRescueScene', wilderness: true }),
    Object.freeze({ id: 'opening-hunundi-room', label: "Opening — Father Hunundi's Room", builder: 'buildHunundiMeetingScene', wilderness: false }),
    Object.freeze({ id: 'opening-farm-tour', label: 'Opening — Spearhead Shows the Farm', builder: 'buildFarmTourScene', authoringArgs: 'farmTour', virtualMap: 'farm' }),
    Object.freeze({ id: 'banubu-intro', label: 'Banubu — Wake-up conversation', banubuTree: 'banubu_intro' }),
    Object.freeze({ id: 'banubu-key', label: 'Banubu — Pie, standing and Color Pools Key', banubuTree: 'banubu_q1_ready' }),
  ]); // Used by the injected selector and the public debug surface so the Director always loads shipping scene builders instead of copied JSON.
  const REQUIRED_STORY_BUILDERS = Object.freeze(REPO_SCENES.map(scene => scene.builder).filter(Boolean)); // Used by story-module readiness checks so every visible selector entry is guaranteed callable.
  const STORY_SCRIPT_URL = new URL('../../js/opening-story-cutscene.js?v=20261003repo-selector3', location.href).href; // Used to load the same authored builders the live opening sequence calls.
  const NPC_DB_URL = new URL('../../config/npcs/hobunji-starter-npc-database.json', location.href).href; // Used to supply canonical NPC records to those builders.
  const DIRECTOR_STORAGE_KEY = 'hobunjiCutsceneDirector.v1'; // Used by reload-based imports that still pass through the Director's startup normalizeProject path.
  const PENDING_WILDERNESS_KEY = 'hobunjiCutsceneDirector.repoWilderness.v1'; // Used after fallback reload to restore a procedural-wilderness scene with the Director's existing wilderness controls.
  const PENDING_VIRTUAL_MAP_KEY = 'hobunjiCutsceneDirector.repoVirtualMap.v1'; // Used after farm-tour reload to explain that the Director is intentionally using its blank authoring grid while Game Preview supplies the live farm.
  let storyPromise = null; // Shared by repeated selector loads so the authored story module is fetched once.
  let npcRecordsPromise = null; // Shared by repeated selector loads so the canonical NPC database is fetched once.

  function notify(message, isError = false) {
    const toast = document.getElementById('toast'); // Reuses the Director's existing mobile-readable status surface without reaching into its private IIFE.
    if (!toast) return;
    toast.textContent = message;
    toast.style.borderColor = isError ? '#d66b68' : '';
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => {
      toast.classList.remove('show');
      toast.style.borderColor = '';
    }, 3200);
  }

  const scriptLoads = new Map(); // Deduplicates all source modules, including parallel Banubu requests.
  function loadScriptOnce(src) {
    if (scriptLoads.has(src)) return scriptLoads.get(src);
    const pending = new Promise((resolve, reject) => {
      const existing = [...document.scripts].find(script => script.src === src);
      if (existing) {
        if (existing.dataset.repoCutsceneLoaded === 'true' || (src.includes('/opening-story-cutscene.js') && window.OpeningStoryCutscene) || (src.includes('/banubu-quest-content.js') && window.BanubuQuestContent) || (src.includes('/banubu-cutscene-authoring.js') && window.BanubuCutsceneAuthoring)) { resolve(); return; }
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', () => reject(new Error('Could not load cutscene source: ' + src + '')), { once: true });
        return;
      }
      const script = document.createElement('script'); // Injected only inside Cutscene Director so other tools do not gain story-specific globals.
      script.src = src;
      script.addEventListener('load', () => { script.dataset.repoCutsceneLoaded = 'true'; resolve(); }, { once: true });
      script.addEventListener('error', () => reject(new Error('Could not load cutscene source: ' + src + '')), { once: true });
      (document.head || document.documentElement).appendChild(script);
    });
    scriptLoads.set(src, pending);
    pending.catch(() => scriptLoads.delete(src));
    return pending;
  }

  function assertStoryApi(api) {
    const missing = REQUIRED_STORY_BUILDERS.filter(name => typeof api?.[name] !== 'function'); // Keeps the selector catalog and live story module from silently drifting apart.
    if (missing.length) throw new Error(`Opening-story builders unavailable: ${missing.join(', ')}`);
    return api;
  }

  async function ensureStoryApi() {
    if (window.OpeningStoryCutscene) return assertStoryApi(window.OpeningStoryCutscene);
    storyPromise ||= loadScriptOnce(STORY_SCRIPT_URL).then(() => assertStoryApi(window.OpeningStoryCutscene));
    return storyPromise;
  }

  async function loadNpcRecords() {
    npcRecordsPromise ||= fetch(NPC_DB_URL).then(async response => {
      if (!response.ok) throw new Error(`NPC database HTTP ${response.status}`);
      const json = await response.json();
      const list = Array.isArray(json?.npcs) ? json.npcs : [];
      if (!list.length) throw new Error('The repo NPC database is empty.');
      return new Map(list.map(record => [record.id, record]));
    });
    return npcRecordsPromise;
  }

  function authoringProfile() {
    return {
      nickname: String(window.__hobunjiPlayerProfile?.nickname || 'Player'),
      characterId: 'cutscene-director-authoring',
      worldId: 'cutscene-director-authoring',
      isWorldOwner: true,
    }; // Builders currently only need the player label, while stable ids keep future profile-aware authoring deterministic.
  }

  function authoringFarmTourPoints() {
    const cols = 36, rows = 26, aspect = 16 / 9; // Mirrors the current shipping farm-tour regression fixture so repo authoring is deterministic instead of depending on a particular save's moved farmhouse.
    const entry = { c: 2, r: 3 }; // Used as the player's representative farm arrival tile in the Director-only authoring fixture.
    const guide = { c: 3, r: 3 }; // Used as Spearhead's adjacent starting tile in the Director-only authoring fixture.
    const porch = { c: 8, r: 9 }; // Used as Spearhead's representative farmhouse approach tile for editing movement/camera stages.
    const playerPorch = { c: 7, r: 9 }; // Used as the player's neighboring farmhouse stop so both walkers remain separately inspectable.
    const camera = {
      id: 'farm_introduction_south', label: 'Farm introduction south camera',
      position: { x: cols / 2, y: Math.max(rows + 8, cols / aspect * .85 + 8) / 2, z: rows - .5 },
      target: { x: cols / 2, y: 1, z: rows / 2 },
      fovDeg: 75, blendSeconds: 1.25, trackSpeaker: false, stagePlayer: false,
    }; // Matches openingFarmTourPoints()' current wide south-to-north camera math at the desktop authoring aspect.
    const houseCamera = {
      id: 'farm_introduction_house',
      position: { x: porch.c + .5, y: 3, z: porch.r + 8.5 },
      target: { x: porch.c + .5, y: 1.7, z: porch.r - .5 },
      fovDeg: 60, blendSeconds: 1.25, trackSpeaker: false,
    }; // Represents a north-facing farmhouse door; live gameplay still rebuilds this camera from the player's actual rotated farmhouse door normal.
    return { entry, guide, porch, playerPorch, camera, houseCamera };
  }

  function authoringArgsFor(entry) {
    if (entry.authoringArgs === 'farmTour') return [authoringFarmTourPoints()];
    return [];
  }

  async function buildRepoScene(sceneId) {
    const entry = REPO_SCENES.find(scene => scene.id === sceneId);
    if (!entry) throw new Error(`Unknown repo cutscene: ${sceneId}`);
    if (entry.banubuTree) {
      await Promise.all([
        window.BanubuQuestContent ? null : loadScriptOnce(new URL('../../js/banubu-quest-content.js?v=20261004banubu1', location.href).href),
        window.BanubuCutsceneAuthoring ? null : loadScriptOnce(new URL('../../js/banubu-cutscene-authoring.js?v=20261004banubu1', location.href).href),
      ]);
      const [records, response] = await Promise.all([loadNpcRecords(), fetch(new URL('../../config/locales/locale_banubu_cave_interior.json', location.href).href)]);
      if (!response.ok) throw new Error('Banubu locale HTTP ' + response.status);
      const npc = records.get('banubu');
      const tree = npc?.dialogueTrees?.find(t => t.id === entry.banubuTree) || window.BanubuQuestContent.dialogueTrees.find(t => t.id === entry.banubuTree);
      return { entry, scene: window.BanubuCutsceneAuthoring.build(tree, npc, await response.json()) };
    }
    const [api, records] = await Promise.all([ensureStoryApi(), loadNpcRecords()]);
    const builder = api[entry.builder];
    const scene = builder(records, authoringProfile(), ...authoringArgsFor(entry));
    if (!scene?.actors?.length || !scene?.stages?.length) throw new Error(`${entry.label} did not produce a valid scene.`);
    return { entry, scene };
  }

  function selectWildernessAfterImport(mapId) {
    if (!mapId) return;
    setTimeout(() => {
      const select = document.getElementById('wildernessSelect');
      const button = document.getElementById('useWildernessBtn');
      if (!select || !button) return;
      const option = [...select.options].find(item => item.value === mapId);
      if (!option) { notify(`Loaded the scene, but wilderness ${mapId} is not available in this Director build.`, true); return; }
      select.value = mapId;
      button.click();
    }, 80);
  }

  function handSceneToDirector(entry, scene) {
    const importInput = document.getElementById('importFile');
    if (!importInput) throw new Error('The Director import control is unavailable.');
    const isWilderness = Boolean(entry.wilderness || scene.wilderness); // Used to avoid sending procedural map ids through the static-map loader during JSON import.
    const importScene = isWilderness ? { ...scene, mapId: '' } : scene; // Wilderness context is restored immediately afterward through the Director's real Use Wilderness Zone control.

    if (entry.virtualMap) {
      localStorage.setItem(DIRECTOR_STORAGE_KEY, JSON.stringify(scene)); // Startup still runs normalizeProject(), while preserving mapId='farm' for authoritative Game Preview.
      localStorage.setItem(PENDING_VIRTUAL_MAP_KEY, entry.virtualMap);
      location.reload();
      return;
    }

    if (typeof DataTransfer === 'function' && typeof File === 'function') {
      const transfer = new DataTransfer(); // Reuses the Director's tested JSON import path instead of duplicating its private normalization/state logic.
      const file = new File([JSON.stringify(importScene, null, 2)], `${entry.id}.json`, { type: 'application/json' });
      transfer.items.add(file);
      importInput.files = transfer.files;
      importInput.dispatchEvent(new Event('change', { bubbles: true }));
      if (isWilderness) selectWildernessAfterImport(scene.mapId);
      return;
    }

    localStorage.setItem(DIRECTOR_STORAGE_KEY, JSON.stringify(importScene)); // Older browsers fall back to the Director's normal startup autosave path.
    if (isWilderness) localStorage.setItem(PENDING_WILDERNESS_KEY, scene.mapId || '');
    location.reload();
  }

  async function loadRepoScene(sceneId) {
    const select = document.getElementById('repoCutsceneSelect');
    const button = document.getElementById('repoCutsceneLoadBtn');
    if (select) select.disabled = true;
    if (button) button.disabled = true;
    try {
      const { entry, scene } = await buildRepoScene(sceneId);
      handSceneToDirector(entry, scene);
      notify(`Loaded repo cutscene: ${entry.label}`);
      return scene;
    } catch (error) {
      console.error('[cutscene-director repo selector]', error);
      notify(`Repo cutscene load failed: ${error.message}`, true);
      throw error;
    } finally {
      if (select) select.disabled = false;
      if (button) button.disabled = false;
    }
  }

  function injectSelector() {
    const actions = document.querySelector('.header-actions');
    if (!actions || document.getElementById('repoCutsceneSelect')) return;

    const wrap = document.createElement('div'); // Header-local wrapper keeps the repo selector usable in the Tool Hub iframe and on narrow mobile layouts.
    wrap.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;';
    const select = document.createElement('select');
    select.id = 'repoCutsceneSelect';
    select.title = 'Choose a cutscene built directly from the repository authoring code';
    select.style.cssText = 'width:auto;min-width:220px;max-width:min(48vw,360px);height:36px;padding:5px 8px;';
    select.innerHTML = '<option value="">Repo cutscenes…</option>' + REPO_SCENES.map(scene => `<option value="${scene.id}">${scene.label}</option>`).join('');

    const button = document.createElement('button');
    button.id = 'repoCutsceneLoadBtn';
    button.type = 'button';
    button.textContent = 'Load repo scene';
    button.title = 'Build the selected scene from the live repository scene builder and open it in the Director';
    button.addEventListener('click', () => {
      if (!select.value) { notify('Choose a repo cutscene first.'); return; }
      loadRepoScene(select.value).catch(() => {});
    });
    select.addEventListener('change', () => { button.classList.toggle('primary', Boolean(select.value)); });

    wrap.append(select, button);
    actions.prepend(wrap);
  }

  function restoreFallbackWilderness() {
    const mapId = localStorage.getItem(PENDING_WILDERNESS_KEY);
    if (!mapId) return;
    localStorage.removeItem(PENDING_WILDERNESS_KEY);
    selectWildernessAfterImport(mapId);
  }

  function restoreVirtualMapNotice() {
    const mapId = localStorage.getItem(PENDING_VIRTUAL_MAP_KEY);
    if (!mapId) return;
    localStorage.removeItem(PENDING_VIRTUAL_MAP_KEY);
    setTimeout(() => notify(`${mapId === 'farm' ? 'Farm tour' : mapId} loaded on the Director practice grid; Preview in game uses the live ${mapId} map.`), 120);
  }

  function init() {
    injectSelector();
    restoreFallbackWilderness();
    restoreVirtualMapNotice();
  }

  window.CutsceneDirectorRepoScenes = Object.freeze({
    catalog: REPO_SCENES.map(({ id, label, builder }) => Object.freeze({ id, label, builder })),
    authoringFarmTourPoints: () => JSON.parse(JSON.stringify(authoringFarmTourPoints())),
    build: buildRepoScene,
    load: loadRepoScene,
  }); // Mobile/debug callers can inspect repo-authored scenes and the deterministic farm fixture without DevTools source spelunking.

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
