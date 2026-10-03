(() => {
  'use strict';

  if (!/\/tools\/cutscene-director\//.test(location.pathname)) return;

  const REPO_SCENES = Object.freeze([
    Object.freeze({ id: 'opening-rescue', label: 'Opening — Cloud Forest Rescue', builder: 'buildRescueScene', wilderness: true }),
    Object.freeze({ id: 'opening-hunundi-room', label: "Opening — Father Hunundi's Room", builder: 'buildHunundiMeetingScene', wilderness: false }),
  ]); // Used by the injected selector and the public debug surface so the Director always loads shipping scene builders instead of copied JSON.
  const STORY_SCRIPT_URL = new URL('../../js/opening-story-cutscene.js?v=20261003repo-selector1', location.href).href; // Used to load the same authored builders the live opening sequence calls.
  const NPC_DB_URL = new URL('../../config/npcs/hobunji-starter-npc-database.json', location.href).href; // Used to supply canonical NPC records to those builders.
  const DIRECTOR_STORAGE_KEY = 'hobunjiCutsceneDirector.v1'; // Used only by the no-DataTransfer fallback to hand a built repo scene back through the Director's existing startup path.
  const PENDING_WILDERNESS_KEY = 'hobunjiCutsceneDirector.repoWilderness.v1'; // Used after fallback reload to restore a procedural-wilderness scene with the Director's existing wilderness controls.
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
    }, 2600);
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find(script => script.src === src);
      if (existing) {
        if (window.OpeningStoryCutscene) { resolve(); return; }
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', () => reject(new Error('Could not load the opening-story cutscene module.')), { once: true });
        return;
      }
      const script = document.createElement('script'); // Injected only inside Cutscene Director so other tools do not gain story-specific globals.
      script.src = src;
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', () => reject(new Error('Could not load the opening-story cutscene module.')), { once: true });
      (document.head || document.documentElement).appendChild(script);
    });
  }

  async function ensureStoryApi() {
    if (window.OpeningStoryCutscene?.buildRescueScene && window.OpeningStoryCutscene?.buildHunundiMeetingScene) return window.OpeningStoryCutscene;
    storyPromise ||= loadScriptOnce(STORY_SCRIPT_URL).then(() => {
      const api = window.OpeningStoryCutscene;
      if (!api?.buildRescueScene || !api?.buildHunundiMeetingScene) throw new Error('Opening-story builders are unavailable after the repo module loaded.');
      return api;
    });
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

  async function buildRepoScene(sceneId) {
    const entry = REPO_SCENES.find(scene => scene.id === sceneId);
    if (!entry) throw new Error(`Unknown repo cutscene: ${sceneId}`);
    const [api, records] = await Promise.all([ensureStoryApi(), loadNpcRecords()]);
    const builder = api[entry.builder];
    if (typeof builder !== 'function') throw new Error(`Repo cutscene builder "${entry.builder}" is unavailable.`);
    const scene = builder(records, authoringProfile());
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

    if (typeof DataTransfer === 'function' && typeof File === 'function') {
      const transfer = new DataTransfer(); // Reuses the Director's tested JSON import path instead of duplicating its private normalization/state logic.
      const file = new File([JSON.stringify(scene, null, 2)], `${entry.id}.json`, { type: 'application/json' });
      transfer.items.add(file);
      importInput.files = transfer.files;
      importInput.dispatchEvent(new Event('change', { bubbles: true }));
      if (entry.wilderness || scene.wilderness) selectWildernessAfterImport(scene.mapId);
      return;
    }

    localStorage.setItem(DIRECTOR_STORAGE_KEY, JSON.stringify(scene)); // Older browsers fall back to the Director's normal startup autosave path.
    if (entry.wilderness || scene.wilderness) localStorage.setItem(PENDING_WILDERNESS_KEY, scene.mapId || '');
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

  function init() {
    injectSelector();
    restoreFallbackWilderness();
  }

  window.CutsceneDirectorRepoScenes = Object.freeze({
    catalog: REPO_SCENES.map(({ id, label, builder }) => Object.freeze({ id, label, builder })),
    build: buildRepoScene,
    load: loadRepoScene,
  }); // Mobile/debug callers can inspect what repo-authored scenes the Director exposes without DevTools source spelunking.

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
