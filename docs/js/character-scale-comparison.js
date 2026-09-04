// Animation Author full-character species/gender scale comparison tab.
(() => {
  'use strict';
  if (!/\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname)) return;

  const MODE = 'scale-compare';
  const TAB_ID = 'maaFullScaleTab';
  const PANEL_ID = 'maaFullScalePanel';
  const MULTI_SAVE_KEY = 'hobunjiMultiAvatarAnimationAuthor.project.v1';
  const RIG_SAVE_KEY = 'hobunjiAttachmentRigProfiles.v2';
  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const docsBase = selfUrl ? new URL('../', selfUrl) : new URL('../../', location.href);
  const npcDbUrl = new URL('config/npcs/hobunji-starter-npc-database.json', docsBase).href;
  const chairUrl = new URL('config/furniture-authored/chairSimple.json', docsBase).href;

  let active = false;
  let building = false;
  let generation = 0;
  let originMode = 'multi';
  let savedMulti = null;
  let entries = [];
  let selected = null;
  let chair = null;
  let THREE = null;
  let persistTimer = 0;
  let frameRaf = 0;

  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const normalizeSpecies = value => String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const normalizeGender = value => {
    const gender = String(value || '').trim().toLowerCase();
    return gender === 'f' ? 'female' : gender === 'm' ? 'male' : gender;
  };
  const canonicalSpecies = value => {
    const species = normalizeSpecies(value);
    if (typeof window.hobunjiTransformSpeciesId === 'function') return normalizeSpecies(window.hobunjiTransformSpeciesId(species));
    return species === 'rakakoan' ? 'kenkari' : species === 'ghoul' ? 'mao-ao' : species;
  };
  const prettySpecies = value => String(value || '').split('-').map(part => part ? part[0].toUpperCase() + part.slice(1) : '').join('-');
  const clampPercent = value => Math.max(25, Math.min(200, Number(value) || 100));

  function profileDescriptors() {
    const profiles = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {};
    const seen = new Set();
    const out = [];
    for (const [key, profile] of Object.entries(profiles)) {
      const [rawSpecies, rawGender] = key.split('::');
      const keySpecies = normalizeSpecies(rawSpecies);
      const profileSpecies = normalizeSpecies(profile?.species || keySpecies);
      const gender = normalizeGender(rawGender || profile?.gender);
      // Exclude transform aliases such as ghoul -> mao-ao and rakakoan -> kenkari.
      if (!keySpecies || keySpecies !== profileSpecies || !['male', 'female'].includes(gender)) continue;
      const species = canonicalSpecies(keySpecies);
      const canonicalKey = `${species}::${gender}`;
      if (seen.has(canonicalKey)) continue;
      seen.add(canonicalKey);
      out.push({ key: canonicalKey, species, gender });
    }
    return out;
  }

  function npcAppearance(npc) {
    try {
      const strict = window.strictNpcAppearanceV1514?.(npc);
      if (strict?.speciesId && strict?.gender) return strict;
    } catch (_) {}
    const raw = npc?.avatarEditor?.rawExport || {};
    const profile = raw.profile || raw.avatarProfile || raw.npcProfile || raw;
    const appearance = { ...(npc?.appearance || {}), ...(profile?.appearance || {}), ...(profile?.visuals?.appearance || {}), ...(raw?.appearance || {}) };
    return {
      speciesId: normalizeSpecies(appearance.speciesId || appearance.species || npc?.species),
      gender: normalizeGender(appearance.gender || npc?.gender),
    };
  }

  function isChild(npc) {
    try { return !!window.PNGPlaneAvatar?.isChildAvatar?.({ npcRecord: npc }); }
    catch (_) {}
    const markers = [npc?.ageBand, npc?.role, ...(npc?.tags || []), ...(npc?.roles || [])].map(value => String(value || '').toLowerCase());
    return markers.includes('child');
  }

  async function json(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  }

  async function representatives() {
    const db = await json(npcDbUrl);
    const npcs = Array.isArray(db?.npcs) ? db.npcs : [];
    return profileDescriptors().map(target => {
      const candidates = npcs.map(npc => ({ npc, appearance: npcAppearance(npc) }))
        .filter(item => item.appearance.gender === target.gender);
      const exact = candidates.filter(item => normalizeSpecies(item.appearance.speciesId) === target.species);
      const compatible = candidates.filter(item => canonicalSpecies(item.appearance.speciesId) === target.species);
      const pool = exact.length ? exact : compatible;
      const picked = pool.find(item => !isChild(item.npc)) || pool[0] || null;
      return { ...target, npc: picked?.npc || null };
    });
  }

  function ensureStyle() {
    if (document.getElementById('maaFullScaleStyle')) return;
    const style = document.createElement('style');
    style.id = 'maaFullScaleStyle';
    style.textContent = `
body[data-animation-author-mode="${MODE}"] #maaLeftPanel,
body[data-animation-author-mode="${MODE}"] #maaRightPanel,
body[data-animation-author-mode="${MODE}"] #maaTimeline,
body[data-animation-author-mode="${MODE}"] #maaPlayBtn,
body[data-animation-author-mode="${MODE}"] #maaStopBtn,
body[data-animation-author-mode="${MODE}"] #maaNewBtn,
body[data-animation-author-mode="${MODE}"] #maaUndoBtn{display:none!important}
body[data-animation-author-mode="${MODE}"] #maaViewportBadge{left:12px;right:12px;max-width:none;text-align:center}
#${PANEL_ID}{display:none;position:absolute;z-index:18;left:50%;bottom:max(10px,env(safe-area-inset-bottom));transform:translateX(-50%);width:min(680px,calc(100% - 20px));padding:10px;border:1px solid rgba(255,255,255,.16);border-radius:14px;background:rgba(7,16,26,.94);backdrop-filter:blur(10px);gap:8px}
body[data-animation-author-mode="${MODE}"] #${PANEL_ID}{display:grid}
#${PANEL_ID} .scaleHead{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#${PANEL_ID} .scaleSelected{font-weight:850;color:var(--accent)}
#${PANEL_ID} .scaleRow{display:grid;grid-template-columns:minmax(0,1fr) 68px;gap:8px;align-items:center}
#${PANEL_ID} input[type=range]{width:100%;min-height:44px;padding:0;accent-color:var(--accent)}
#${PANEL_ID} output{text-align:right;color:var(--accent);font-weight:850;font-variant-numeric:tabular-nums}
#${PANEL_ID} .scaleActions{display:flex;gap:7px;flex-wrap:wrap}
#${PANEL_ID} .scaleStatus{font-size:10px;color:var(--muted)}
`;
    document.head.appendChild(style);
  }

  function ensureUi() {
    ensureStyle();
    const tabs = document.getElementById('maaModeTabs');
    const workspace = document.getElementById('maaWorkspace');
    if (!tabs || !workspace) return false;

    if (!document.getElementById(TAB_ID)) {
      const tab = document.createElement('button');
      tab.id = TAB_ID;
      tab.type = 'button';
      tab.className = 'secondary';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', 'false');
      tab.textContent = 'Full character scale';
      tabs.appendChild(tab);
      tab.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        enter();
      }, true);
    }

    if (!document.getElementById(PANEL_ID)) {
      const panel = document.createElement('div');
      panel.id = PANEL_ID;
      panel.className = 'maaInteractive';
      panel.innerHTML = `
        <div class="scaleHead"><b>Full character scale</b><span id="maaFullScaleSelected" class="scaleSelected">Tap a character</span><span id="maaFullScaleNpc" class="pill">—</span></div>
        <div class="scaleRow"><input id="maaFullScaleRange" type="range" min="25" max="200" step="0.5" value="100" aria-label="Full character scale"><output id="maaFullScaleOut">100%</output></div>
        <div class="scaleActions"><button id="maaFullScaleExport" type="button" class="good">Export scale JSON</button><button id="maaFullScaleFrame" type="button" class="secondary">Frame lineup</button></div>
        <div id="maaFullScaleStatus" class="scaleStatus">The chair at the far right is fixed world size.</div>`;
      workspace.appendChild(panel);
      panel.querySelector('#maaFullScaleRange').addEventListener('input', applySlider);
      panel.querySelector('#maaFullScaleRange').addEventListener('change', persistProfiles);
      panel.querySelector('#maaFullScaleExport').addEventListener('click', exportJson);
      panel.querySelector('#maaFullScaleFrame').addEventListener('click', frame);
    }

    for (const [id, mode] of [['maaMultiTab','multi'],['maaSingleTab','single'],['maaRigTab','rig']]) {
      const tab = document.getElementById(id);
      if (!tab || tab.dataset.fullScaleExit === '1') continue;
      tab.dataset.fullScaleExit = '1';
      tab.addEventListener('click', event => {
        if (!active && !building) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        exit(mode);
      }, true);
    }

    const frameButton = document.getElementById('maaFrameAllBtn');
    if (frameButton && frameButton.dataset.fullScaleFrame !== '1') {
      frameButton.dataset.fullScaleFrame = '1';
      frameButton.addEventListener('click', event => {
        if (!active) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        frame();
      }, true);
    }

    const canvas = document.getElementById('view3d');
    if (canvas && canvas.dataset.fullScalePick !== '1') {
      canvas.dataset.fullScalePick = '1';
      canvas.addEventListener('click', () => {
        if (!active) return;
        setTimeout(() => {
          const actor = window.selectedAnimationActor?.();
          const entry = entries.find(item => item.actor?.id === actor?.id);
          if (entry) select(entry);
          chrome();
        }, 0);
      });
    }
    return true;
  }

  function status(text) {
    const node = document.getElementById('maaFullScaleStatus');
    if (node) node.textContent = text;
  }

  function chrome() {
    if (!active && !building) return;
    document.body.dataset.animationAuthorMode = MODE;
    for (const id of ['maaMultiTab','maaSingleTab','maaRigTab']) document.getElementById(id)?.setAttribute('aria-selected','false');
    document.getElementById(TAB_ID)?.setAttribute('aria-selected','true');
    const badge = document.getElementById('maaViewportBadge');
    if (badge) badge.textContent = 'Full character scale comparison · tap/click any character, then adjust the slider. chairSimple is a fixed world-size reference.';
  }

  function select(entry) {
    selected = entry;
    const scale = Number(entry.profile?.anatomy?.rigScale ?? 1);
    document.getElementById('maaFullScaleSelected').textContent = `${prettySpecies(entry.species)} · ${entry.gender}`;
    document.getElementById('maaFullScaleNpc').textContent = entry.npc?.name || entry.npc?.id || 'Repository NPC';
    document.getElementById('maaFullScaleRange').value = String(clampPercent(scale * 100));
    document.getElementById('maaFullScaleOut').textContent = `${Math.round(scale * 1000) / 10}%`;
  }

  function applySlider(event) {
    if (!active || !selected) return;
    const percent = clampPercent(event.currentTarget.value);
    const scale = percent / 100;
    selected.profile.anatomy ||= {};
    selected.profile.anatomy.rigScale = scale;
    const globalProfile = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[selected.key];
    if (globalProfile) {
      globalProfile.anatomy ||= {};
      globalProfile.anatomy.rigScale = scale;
    }
    window.HobunjiCharacterRigScale?.applyToParent?.(selected.actor.visualOffset, selected.species, selected.gender, scale);
    document.getElementById('maaFullScaleOut').textContent = `${Math.round(percent * 10) / 10}%`;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistProfiles, 180);
    if (frameRaf) cancelAnimationFrame(frameRaf);
    frameRaf = requestAnimationFrame(frame);
  }

  function persistProfiles() {
    clearTimeout(persistTimer);
    persistTimer = 0;
    try {
      const data = window.serializeAttachmentRigLibrary?.();
      if (data) localStorage.setItem(RIG_SAVE_KEY, JSON.stringify(data));
    } catch (error) { console.warn('[full-character-scale] profile autosave failed', error); }
  }

  function exportJson() {
    const data = {};
    for (const descriptor of profileDescriptors()) {
      const profile = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[descriptor.key];
      data[descriptor.species] ||= {};
      data[descriptor.species][descriptor.gender] = Math.round(Number(profile?.anatomy?.rigScale ?? 1) * 10000) / 10000;
    }
    const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hobunji_full_character_scales.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    status('Exported species + gender full-character scales only.');
  }

  async function buildChair() {
    const config = await json(chairUrl);
    const group = new THREE.Group();
    group.name = 'FullScaleReference_chairSimple';
    for (const part of (config?.parts || [])) {
      if (!['box','legSquare'].includes(part?.kind)) continue;
      const t = part.transform || {};
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshBasicMaterial({ color: part.color || '#8b6540' }));
      mesh.position.set(Number(t.x)||0, Number(t.y)||0, Number(t.z)||0);
      mesh.rotation.set(THREE.MathUtils.degToRad(Number(t.rx)||0), THREE.MathUtils.degToRad(Number(t.ry)||0), THREE.MathUtils.degToRad(Number(t.rz)||0));
      mesh.scale.set(Math.abs(Number(t.sx)||0.01), Math.abs(Number(t.sy)||0.01), Math.abs(Number(t.sz)||0.01));
      group.add(mesh);
    }
    return group;
  }

  function disposeChair() {
    if (!chair) return;
    chair.parent?.remove(chair);
    chair.traverse(node => {
      node.geometry?.dispose?.();
      node.material?.dispose?.();
    });
    chair = null;
  }

  function layout() {
    if (!THREE || !entries.length) return;
    const parent = entries[0].actor.root.parent;
    if (!parent) return;
    if (chair) chair.parent?.remove(chair);
    let cursor = 0;
    for (const entry of entries) {
      entry.actor.root.position.set(0,0,0);
      entry.actor.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(entry.actor.visualOffset || entry.actor.model);
      const width = Math.max(0.45, box.getSize(new THREE.Vector3()).x);
      const centerX = box.getCenter(new THREE.Vector3()).x;
      entry._lineX = cursor + width / 2 - centerX;
      cursor += width + 0.34;
    }
    if (chair) {
      parent.add(chair);
      chair.position.set(cursor + 0.48,0,0);
      chair.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(chair);
      const width = Math.max(0.45, box.getSize(new THREE.Vector3()).x);
      chair.position.x += width / 2 - box.getCenter(new THREE.Vector3()).x;
      cursor += 0.48 + width;
    }
    const shift = cursor / 2;
    for (const entry of entries) entry.actor.root.position.x = entry._lineX - shift;
    if (chair) chair.position.x -= shift;
  }

  function frame() {
    if (!active && !building) return;
    window.frameAllAnimationActors?.('front');
  }

  function preserveMultiSave() {
    if (!savedMulti) return;
    try { localStorage.setItem(MULTI_SAVE_KEY, JSON.stringify(savedMulti)); } catch (_) {}
  }

  async function buildLineup(buildId) {
    const reps = await representatives();
    const missing = reps.filter(item => !item.npc);
    if (missing.length) status(`Missing preview NPC: ${missing.map(item => item.key).join(', ')}`);
    entries = [];
    for (const rep of reps) {
      if (buildId !== generation || !rep.npc) continue;
      await window.addNpcAnimationActor(rep.npc.id || rep.npc.name);
      if (buildId !== generation) return;
      const actor = window.selectedAnimationActor?.();
      const profile = actor ? window.attachmentRigProfileForActor?.(actor) : null;
      if (!actor || !profile) continue;
      profile.anatomy ||= {};
      if (!Number.isFinite(Number(profile.anatomy.rigScale))) profile.anatomy.rigScale = 1;
      entries.push({ ...rep, actor, profile });
      window.HobunjiCharacterRigScale?.applyToParent?.(actor.visualOffset, rep.species, rep.gender, profile.anatomy.rigScale);
      chrome();
    }
    if (!entries.length) throw new Error('No repository character previews could be built.');
    THREE = (await window.PNGPlaneAvatar?.loadThreeModules?.())?.THREE || null;
    if (!THREE) throw new Error('Three.js is unavailable.');
    chair = await buildChair();
    layout();
    window.selectAnimationActor?.(entries[0].actor.id);
    select(entries[0]);
    frame();
    setTimeout(preserveMultiSave, 350); // Temporary lineup must never replace the real multi-avatar autosave.
  }

  async function enter() {
    if (active || building || !ensureUi()) return;
    building = true;
    const buildId = ++generation;
    originMode = ['multi','single','rig'].includes(document.body.dataset.animationAuthorMode) ? document.body.dataset.animationAuthorMode : 'multi';
    try {
      if (originMode !== 'multi') await window.setAnimationAuthorMode('multi');
      savedMulti = clone(window.MultiAvatarAnimationAuthor?.exportProject?.());
      if (!savedMulti) throw new Error('Could not snapshot the multi-avatar workspace.');
      preserveMultiSave();
      window.clearAnimationActors?.();
      chrome();
      status('Building one adult repository NPC per species + gender…');
      await buildLineup(buildId);
      if (buildId !== generation) return;
      building = false;
      active = true;
      chrome();
      status('Tap/click a character, then move the slider. The chair is a fixed world-size reference.');
    } catch (error) {
      console.warn('[full-character-scale]', error);
      building = false;
      active = false;
      status(`Could not build scale comparison: ${error.message}`);
      await restore(originMode);
    }
  }

  async function restore(targetMode) {
    disposeChair();
    selected = null;
    entries = [];
    try { window.clearAnimationActors?.(); } catch (_) {}
    if (savedMulti) {
      try { await window.MultiAvatarAnimationAuthor?.importProject?.(clone(savedMulti)); }
      catch (error) { console.warn('[full-character-scale] multi restore failed', error); }
      preserveMultiSave();
    }
    if (targetMode && targetMode !== 'multi') await window.setAnimationAuthorMode?.(targetMode);
    document.getElementById(TAB_ID)?.setAttribute('aria-selected','false');
  }

  async function exit(targetMode = originMode) {
    if (!active && !building) return;
    ++generation;
    active = false;
    building = false;
    persistProfiles();
    if (frameRaf) cancelAnimationFrame(frameRaf);
    frameRaf = 0;
    await restore(targetMode || originMode || 'multi');
    savedMulti = null;
  }

  function install() {
    if (!ensureUi()) return false;
    window.HobunjiFullCharacterScaleComparison = Object.freeze({ enter, exit, exportJson, get active() { return active; } });
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    const ready = !!window.MultiAvatarAnimationAuthor
      && typeof window.setAnimationAuthorMode === 'function'
      && typeof window.addNpcAnimationActor === 'function'
      && typeof window.selectedAnimationActor === 'function'
      && typeof window.attachmentRigProfileForActor === 'function'
      && !!window.HobunjiCharacterRigScale;
    if ((ready && install()) || ++attempts >= 600) clearInterval(timer);
  }, 50);
  install();
})();
