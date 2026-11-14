// Animation Author full-character species/gender scale comparison tab.
//
// The lineup is deliberately NOT built from Animation Author actors. Each entry is
// a preview-only avatar group attached directly to the public backdrop scene, using
// the same free-hand parent and ProceduralLegAnimation setup as the Rig Coordinates
// reference-NPC preview. This keeps comparison previews out of Multi/Rig actor state
// and makes selection independent from the editor's selected actor.
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
  let previewRoot = null; // Holds comparison-only avatar groups and is never registered in Animation Author mode state.
  let chair = null;
  let THREE = null;
  let persistTimer = 0;
  let longoranFeetTimer = 0; // Rebuilds the author-only leg preview after a posture/gait slider settles.
  let longoranWalkTimer = 0; // Runs an isolated, user-requested walk preview; never a gameplay frame loop.
  let focusedEntryKey = null; // Only the explicit Focus selected action changes camera focus; selection and slider edits never reframe it.
  let manualViewInteraction = false; // During progressive loading, prevents a final automatic lineup frame after any actual user input or camera gesture.
  let portraitRenderChain = Promise.resolve(); // Serializes portrait rendering because NpcAvatarPreview temporarily installs the active NPC account shim.

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
  const clampPercent = value => Math.max(10, Math.min(400, Number(value) || 100)); // Matches HobunjiCharacterRigScale's own [0.1, 4] clamp.
  const clampOffsetPercent = value => Math.max(-50, Math.min(50, Number(value) || 0)); // Matches HobunjiCharacterRigScale.maxOffsetFraction.
  const clampAgePercent = value => Math.max(0, Math.min(100, Number(value) || 0));
  const LONGORAN_TUNING = Object.freeze({
    Hunch: { field: 'hunch', min: 0, max: 100 },
    Kyphosis: { field: 'kyphosis', min: 0, max: 100 },
  }); // Match Enemy Loadout Editor: only the static spine shape is authored here, in percent. Gait keeps its shared Maskbound defaults.

  function host() {
    return window.HobunjiAnimationAuthorScaleHost || window.HobunjiAnimationAuthorHost || null;
  }

  function profileDescriptors() {
    const profiles = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {};
    const seen = new Set();
    const out = [];
    for (const [key, profile] of Object.entries(profiles)) {
      const [rawSpecies, rawGender] = key.split('::');
      const keySpecies = normalizeSpecies(rawSpecies);
      const profileSpecies = normalizeSpecies(profile?.species || keySpecies);
      const gender = normalizeGender(rawGender || profile?.gender);
      if (!keySpecies || keySpecies !== profileSpecies || !['male', 'female'].includes(gender)) continue;
      const species = canonicalSpecies(keySpecies);
      const canonicalKey = `${species}::${gender}`;
      if (seen.has(canonicalKey)) continue;
      seen.add(canonicalKey);
      out.push({ key: canonicalKey, species, gender });
    }
    return out;
  }

  function portraitExportFor(npc) {
    npc ||= {};
    const raw = npc.avatarEditor?.rawExport || {};
    const profile = raw.profile || raw.avatarProfile || raw.npcProfile || raw;
    const appearance = {
      ...(profile.appearance || {}),
      ...(profile.visuals?.appearance || {}),
      ...(raw.appearance || {}),
      ...(npc.appearance || {}),
    };
    appearance.speciesId = normalizeSpecies(appearance.speciesId || appearance.species || npc.species);
    appearance.gender = normalizeGender(appearance.gender || npc.gender);
    appearance.cosmetics = {
      ...(profile.appearance?.cosmetics || {}),
      ...(profile.visuals?.appearance?.cosmetics || {}),
      ...(raw.appearance?.cosmetics || {}),
      ...(npc.appearance?.cosmetics || {}),
    };
    appearance.bodyColors = {
      ...(profile.appearance?.bodyColors || {}),
      ...(profile.visuals?.appearance?.bodyColors || {}),
      ...(raw.appearance?.bodyColors || {}),
      ...(npc.appearance?.bodyColors || {}),
    };
    const asEquipArray = value => {
      if (Array.isArray(value)) return value.filter(Boolean);
      if (value && typeof value === 'object') return Object.values(value).filter(item => typeof item === 'string' && item);
      return [];
    };
    return {
      name: npc.name || npc.id || 'NPC',
      appearance,
      equippedCosmetics: asEquipArray(raw.equippedCosmetics || profile.equippedCosmetics || profile.cosmetics || profile.equipment || npc.equippedCosmetics),
      appliedDyes: raw.appliedDyes || profile.appliedDyes || profile.dyes || npc.appliedDyes || {},
      portrait: npc.portrait || {},
      rawExport: raw,
    };
  }

  function npcAppearance(npc) {
    return portraitExportFor(npc).appearance;
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
      if (picked) return { ...target, npc: picked.npc };
      // Nuhongan share Tletingan appearance, but must keep their own editable scale.
      const donor = (target.species === 'nuhongan' || target.species === 'longoran')
        ? candidates.find(item => normalizeSpecies(item.appearance.speciesId) === 'tletingan' && !isChild(item.npc))
        : null; // Supplies an adult, same-gender preview without creating a world NPC.
      if (!donor) return { ...target, npc: null };
      const npc = clone(donor.npc); // Isolates preview identity and appearance from the authored NPC database.
      npc.id = `full_scale_${target.species}_${target.gender}_preview`;
      npc.name = `${prettySpecies(target.species)} ${target.gender} comparison`;
      npc.species = target.species;
      npc.gender = target.gender;
      npc.appearance = { ...npcAppearance(donor.npc), speciesId: target.species, gender: target.gender };
      npc.avatarEditor ||= {};
      npc.avatarEditor.rawExport ||= {};
      npc.avatarEditor.rawExport.appearance = clone(npc.appearance);
      for (const profileKey of ['profile', 'avatarProfile', 'npcProfile']) {
        const profile = npc.avatarEditor.rawExport[profileKey]; // Retargets nested Character Studio exports while retaining donor cosmetics and equipment.
        if (profile?.appearance) Object.assign(profile.appearance, { speciesId: target.species, gender: target.gender });
        if (profile?.visuals?.appearance) Object.assign(profile.visuals.appearance, { speciesId: target.species, gender: target.gender });
      }
      return { ...target, npc };
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
#${PANEL_ID} #maaFullScaleChoose{flex:1 1 145px;min-width:0;max-width:100%;padding:6px;border:1px solid rgba(255,255,255,.25);border-radius:6px;background:#17222f;color:inherit}
#${PANEL_ID} .scaleSelected{font-weight:850;color:var(--accent)}
#${PANEL_ID} .scaleRow{display:grid;grid-template-columns:minmax(0,1fr) 68px;gap:8px;align-items:center}
#${PANEL_ID} input[type=range]{width:100%;min-height:44px;padding:0;accent-color:var(--accent)}
#${PANEL_ID} output{text-align:right;color:var(--accent);font-weight:850;font-variant-numeric:tabular-nums}
#${PANEL_ID} .scaleActions{display:flex;gap:7px;flex-wrap:wrap}
#${PANEL_ID} .scaleStatus{font-size:10px;color:var(--muted)}
#${PANEL_ID} #maaFullScaleLongoranControls[hidden],#${PANEL_ID} .scaleRow[hidden]{display:none!important}
#${PANEL_ID} #maaFullScaleLongoranControls{min-width:0;max-height:none;overflow:visible;border:1px solid rgba(255,255,255,.24);padding:8px;border-radius:9px} /* The outer editor rail owns the only scroll surface; 32vh nested clipping previously hid Hunch/Kyphosis. */
#${PANEL_ID} #maaFullScaleLongoranControls .longoranIntro{display:block;margin:4px 0;font-size:11px;line-height:1.35;color:var(--muted)}
#${PANEL_ID} #maaFullScaleLongoranControls .armLengthHint{margin:3px 0 0;font-size:10px;color:var(--muted)}
#${PANEL_ID} .longoranRows{display:grid;grid-template-columns:minmax(0,1fr);gap:5px}
#${PANEL_ID} .longoranTuningRow{display:grid;grid-template-columns:minmax(0,100px) minmax(0,1fr) 67px;gap:7px;align-items:center}
#${PANEL_ID} .longoranTuningRow input[type=number]{width:100%;min-width:0}
#${PANEL_ID} .longoranTuningRow input[type=range]{min-width:0}
#${PANEL_ID} .longoranTuningActions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding-top:6px}
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
      const scaleRow = (axis, label, min, max, step, value, ariaLabel) => `
        <div class="scaleRow">
          <label for="maaFullScaleRange${axis}">${label}</label>
          <input id="maaFullScaleRange${axis}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${ariaLabel}">
          <input id="maaFullScaleNum${axis}" type="number" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${ariaLabel} (exact value)">%
        </div>`;
      const longoranRow = (key, label, min, max, step, value, unit = '') => `
        <label class="longoranTuningRow" for="maaLongoranRange${key}"><span>${label}</span>
          <input id="maaLongoranRange${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="Longoran ${label}">
          <span><input id="maaLongoranNum${key}" type="number" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="Longoran ${label} exact value">${unit}</span>
        </label>`;
      panel.innerHTML = `
        <div class="scaleHead"><b>Full character scale</b><span id="maaFullScaleSelected" class="scaleSelected">Tap a character</span><span id="maaFullScaleNpc" class="pill">—</span><label for="maaFullScaleChoose" class="small">Character</label><select id="maaFullScaleChoose" aria-label="Choose character to edit"></select></div>
        <section id="maaFullScaleLongoranControls" aria-label="Longoran hunch and kyphosis posture" hidden>
          <b>Longoran spine — hunch &amp; kyphosis</b>
          <span class="longoranIntro">Hunch lowers the shoulders; kyphosis curls the neck forward. Both are independently authored for males and females.</span>
          <div class="longoranRows">
            ${longoranRow('Hunch', 'Spine hunch (%)', 0, 100, 1, 10)}
            ${longoranRow('Kyphosis', 'Kyphosis (%)', 0, 100, 1, 100)}
          </div>
          <div class="longoranTuningActions">
            <button id="maaLongoranWalkPreview" type="button" class="secondary" aria-pressed="false">Preview walk</button>
            <button id="maaLongoranExport" type="button" class="secondary">Export Longoran tuning JSON</button>
          </div>
          <p class="armLengthHint">Arm length offset (%) is in Rig Coordinates → Species proportions. It adjusts the free-hanging hands, not the whole-body scale.</p>
        </section>
        ${scaleRow('X', 'Width', 10, 400, 0.5, 100, 'Body width scale')}
        ${scaleRow('Y', 'Height', 10, 400, 0.5, 100, 'Body height scale')}
        ${scaleRow('Head', 'Head', 10, 400, 0.5, 100, 'Head scale')}
        ${scaleRow('OffsetY', 'Head Y offset', -50, 50, 0.5, 0, 'Head Y offset, percent of model height')}
        ${scaleRow('Age', 'Age (hunch)', 0, 100, 1, 0, 'Per-NPC age hunch, lowers the head further')}
        <div class="scaleActions"><button id="maaFullScaleExport" type="button" class="good">Export scale JSON</button><button id="maaFullScaleFrame" type="button" class="secondary">Frame lineup</button><button id="maaFullScaleFocus" type="button" class="secondary" disabled>Focus selected</button><button id="maaFullScaleReset" type="button" class="secondary">Reset all to repo defaults</button></div>
        <div id="maaFullScaleStatus" class="scaleStatus">Preview-only lineup: hands and feet use the Rig Coordinates runtime; no lineup actor is saved into Rig or Multi mode. Head scale/offset are compensated at the neck rig, so stretching width/height never distorts head proportions. Age is per-NPC and composes with Head Y offset for a hunched-over look.</div>`;
      workspace.appendChild(panel);
      panel.querySelector('#maaFullScaleReset').addEventListener('click', resetAllToRepoDefaults);
      panel.querySelector('#maaFullScaleChoose').addEventListener('change', event => {
        manualViewInteraction = true; // An intentional selection must not be followed by a surprise automatic lineup frame.
        const entry = entries.find(item => item.key === event.target.value);
        if (entry) select(entry);
      });
      panel.addEventListener('input', () => { if (active) manualViewInteraction = true; }, true); // Includes head, body and Longoran adjustments, even when another capture listener consumes the event.
      panel.addEventListener('pointerdown', () => { if (active) manualViewInteraction = true; }, true); // Covers Reset all, buttons and mobile taps during background preview loading.
      panel.addEventListener('keydown', () => { if (active) manualViewInteraction = true; }, true); // Covers keyboard-only editing and focus requests without pointer events.
      for (const axis of ['X', 'Y', 'Head', 'OffsetY']) {
        const range = panel.querySelector(`#maaFullScaleRange${axis}`);
        const number = panel.querySelector(`#maaFullScaleNum${axis}`);
        range.addEventListener('input', () => { number.value = range.value; applyBodyHeadSliders(); });
        range.addEventListener('change', persistProfiles);
        number.addEventListener('input', () => { range.value = number.value; applyBodyHeadSliders(); });
        number.addEventListener('change', persistProfiles);
      }
      const ageRange = panel.querySelector('#maaFullScaleRangeAge');
      const ageNumber = panel.querySelector('#maaFullScaleNumAge');
      ageRange.addEventListener('input', () => { ageNumber.value = ageRange.value; applyAgeSlider(); });
      ageRange.addEventListener('change', persistProfiles);
      ageNumber.addEventListener('input', () => { ageRange.value = ageNumber.value; applyAgeSlider(); });
      ageNumber.addEventListener('change', persistProfiles);
      for (const key of Object.keys(LONGORAN_TUNING)) {
        const range = panel.querySelector(`#maaLongoranRange${key}`);
        const number = panel.querySelector(`#maaLongoranNum${key}`);
        range.addEventListener('input', () => { number.value = range.value; applyLongoranSliders(); });
        range.addEventListener('change', () => { applyLongoranSliders(true); persistProfiles(); });
        number.addEventListener('input', () => { if (number.value !== '') { range.value = number.value; applyLongoranSliders(); } });
        number.addEventListener('change', () => { range.value = number.value; applyLongoranSliders(true); persistProfiles(); });
      }
      panel.querySelector('#maaLongoranWalkPreview').addEventListener('click', toggleLongoranWalk);
      panel.querySelector('#maaLongoranExport').addEventListener('click', exportLongoranTuning);
      panel.querySelector('#maaFullScaleExport').addEventListener('click', exportJson);
      panel.querySelector('#maaFullScaleFrame').addEventListener('click', () => { manualViewInteraction = true; frame(); });
      panel.querySelector('#maaFullScaleFocus').addEventListener('click', focusSelected);
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
        manualViewInteraction = true; // Prevents the final loading pass from undoing an explicit top-toolbar frame.
        frame();
      }, true);
    }

    const canvas = document.getElementById('view3d');
    if (canvas && canvas.dataset.fullScalePreviewPick !== '1') {
      canvas.dataset.fullScalePreviewPick = '1';
      let down = null; // Used to ignore camera drags while still allowing simple tap/click selection on mobile and desktop.
      canvas.addEventListener('pointerdown', event => {
        if (document.body.dataset.animationAuthorMode !== MODE) return;
        manualViewInteraction = true; // One-finger orbit or tapping an NPC should prevent a deferred initial auto-frame.
        down = { id: event.pointerId, x: event.clientX, y: event.clientY };
      });
      canvas.addEventListener('wheel', () => {
        if (document.body.dataset.animationAuthorMode === MODE) manualViewInteraction = true; // Desktop zoom during progressive loading is also intentional.
      }, { passive: true });
      canvas.addEventListener('pointerup', event => {
        if (document.body.dataset.animationAuthorMode !== MODE || !down || down.id !== event.pointerId) {
          down = null;
          return;
        }
        const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
        down = null;
        if (moved > 8) return;
        pickAt(event.clientX, event.clientY);
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
    if (badge) badge.textContent = 'Full character scale · preview-only lineup with Rig Coordinates hands and feet. Tap a character to edit that species/gender scale.';
  }

  function setSliderValue(axis, percent) {
    document.getElementById(`maaFullScaleRange${axis}`).value = String(percent);
    document.getElementById(`maaFullScaleNum${axis}`).value = String(Math.round(percent * 10) / 10);
  }

  function syncLongoranKyphosisAvailability() {
    const hunch = Number(document.getElementById('maaLongoranRangeHunch')?.value) || 0; // The same dependency used in Enemy Loadout Editor: no hunch means there can be no forward hook.
    for (const id of ['maaLongoranRangeKyphosis', 'maaLongoranNumKyphosis']) {
      const input = document.getElementById(id);
      if (input) input.disabled = hunch <= 0;
    }
  }

  function select(entry) {
    if (!entry) return;
    if (selected !== entry) stopLongoranWalk();
    selected = entry;
    const chooser = document.getElementById('maaFullScaleChoose');
    if (chooser) chooser.value = entry.key; // Keeps the mobile-friendly selector synchronized with tapping a model in the viewport.
    const focusButton = document.getElementById('maaFullScaleFocus'); // A valid preview selection enables explicit framing for any species/gender.
    if (focusButton) focusButton.disabled = false;
    const scale = window.HobunjiCharacterRigScale?.scaleFor?.(entry.species, entry.gender, entry.profile) || { x: 1, y: 1, head: 1, offsetY: 0 };
    document.getElementById('maaFullScaleSelected').textContent = `${prettySpecies(entry.species)} · ${entry.gender}`;
    document.getElementById('maaFullScaleNpc').textContent = entry.npc?.name || entry.npc?.id || 'Repository NPC';
    for (const [axis, field] of [['X', 'x'], ['Y', 'y'], ['Head', 'head']]) {
      setSliderValue(axis, clampPercent(scale[field] * 100));
    }
    setSliderValue('OffsetY', clampOffsetPercent(scale.offsetY * 100));
    const age = entry.npc?.id ? (host()?.npcAgeFor?.(entry.npc.id) || 0) : 0;
    setSliderValue('Age', clampAgePercent(age * 100));
    const longoranPanel = document.getElementById('maaFullScaleLongoranControls');
    if (longoranPanel) longoranPanel.hidden = entry.species !== 'longoran';
    const npcAgeRow = document.getElementById('maaFullScaleRangeAge')?.closest('.scaleRow'); // Longoran hunch is species-authored; don't show a second, misleading NPC-age hunch input.
    if (npcAgeRow) npcAgeRow.hidden = entry.species === 'longoran';
    if (entry.species === 'longoran') {
      const tune = window.HobunjiLongoranSpecies?.tuningFor?.(entry.gender);
      if (tune) {
        for (const [key, info] of Object.entries(LONGORAN_TUNING)) {
          const value = Number(tune.spine[info.field]) * 100; // Display the same percentage units as Enemy Loadout Editor.
          const formatted = String(Number(value.toFixed(1)));
          document.getElementById(`maaLongoranRange${key}`).value = formatted;
          document.getElementById(`maaLongoranNum${key}`).value = formatted;
        }
        syncLongoranKyphosisAvailability(); // Kyphosis is unavailable until some hunch exists, as in the enemy editor.
      }
    }
    status(`Selected ${prettySpecies(entry.species)} ${entry.gender} · ${entry.npc?.name || entry.npc?.id || 'repository NPC'}. Use Focus selected to center this character without altering the lineup until requested.`);
    // Selection changes the edited character, never camera position, angle, projection, or zoom.
  }

  function currentAgeFraction() {
    return selected?.npc?.id ? (host()?.npcAgeFor?.(selected.npc.id) || 0) : 0;
  }


  function refreshLongoranSpine(entry) {
    if (entry?.species !== 'longoran' || !entry.model) return;
    const api = window.HobunjiLongoranSpecies;
    const spineValues = api?.spineFor?.(entry.gender); // Single authored posture source shared with the game's portrait rig.
    const spine = window.HobunjiCharacterSpine?.bind?.(entry.model, { speciesId: 'longoran', gender: entry.gender, spine: spineValues });
    entry.spinePreviewApplied = !!(spine && window.HobunjiCharacterSpine?.applyToRig?.(entry.model.userData.neckRig, spine, Number(entry.model.userData.portraitModelHeight))); // Exposed in mobile diagnostics if a portrait could not build its skinned spline.
    const scale = window.HobunjiCharacterRigScale?.scaleFor?.('longoran', entry.gender, entry.profile);
    if (scale) window.HobunjiCharacterRigScale?.applyToParent?.(entry.group, 'longoran', entry.gender, scale, spine?.hunch || 0);
  }

  function rebuildLongoranFeet(entry) {
    if (entry?.species !== 'longoran' || !THREE || !entry?.group || !entry.model) return;
    entry.feet?.dispose?.();
    const modelWidth = Number(entry.model.userData?.portraitModelWidth) || avatarBaseWidth();
    const modelHeight = Number(entry.model.userData?.portraitModelHeight) || modelWidth;
    entry.feet = window.ProceduralLegAnimation?.attach?.(THREE, entry.group, {
      speciesId: entry.species, gender: entry.gender, bodyColors: entry.avatarProfile?.bodyColors || entry.npc?.appearance?.bodyColors,
      modelWidth, modelHeight, handAttachY: entry.model.userData.handAttachY,
      profile: entry.avatarProfile, spine: window.HobunjiLongoranSpecies?.spineFor?.(entry.gender),
      gaitProfile: window.HobunjiLongoranSpecies?.gaitFor?.(entry.gender),
      name: `${entry.group.name}_feet`, portraitSize: 200,
    }) || null; // Recreates just the comparison feet, never gameplay actors or other species.
    entry.feet?.update?.(0, 0, false, null);
  }

  function applyLongoranSliders(rebuildNow = false) {
    if (!active || selected?.species !== 'longoran') return;
    const spine = {}; // Only posture is edited here; existing per-gender gait tuning is preserved when saving.
    for (const [key, info] of Object.entries(LONGORAN_TUNING)) {
      const input = document.getElementById(`maaLongoranRange${key}`);
      const number = input?.value === '' ? NaN : Number(input?.value);
      const percent = Number.isFinite(number) ? Math.max(info.min, Math.min(info.max, number)) : info.min;
      spine[info.field] = percent / 100;
      if (input) input.value = String(percent);
      const numberInput = document.getElementById(`maaLongoranNum${key}`);
      if (numberInput) numberInput.value = String(percent);
    }
    window.HobunjiLongoranSpecies?.setAuthorTuning?.(selected.gender, { spine });
    syncLongoranKyphosisAvailability();
    refreshLongoranSpine(selected);
    clearTimeout(longoranFeetTimer);
    if (rebuildNow) rebuildLongoranFeet(selected);
    else {
      const entry = selected; // Debounces expensive foot GLB and bone rebuilds during touch drags.
      longoranFeetTimer = setTimeout(() => { if (selected === entry && active) rebuildLongoranFeet(entry); }, 180);
    }
    status(`Longoran ${selected.gender}: hunch ${Math.round(spine.hunch * 100)}%, kyphosis ${Math.round(spine.kyphosis * 100)}%.${selected.spinePreviewApplied ? '' : ' Spine preview unavailable: this portrait has no usable spline.'} Saved on this device; export tuning to review for repository use.`);
  }

  function stopLongoranWalk() {
    if (longoranWalkTimer) clearInterval(longoranWalkTimer);
    longoranWalkTimer = 0;
    for (const entry of entries) {
      if (entry.model && entry.species === 'longoran') entry.model.rotation.x = 0;
      entry.feet?.update?.(0, 0, false, null);
    }
    const button = document.getElementById('maaLongoranWalkPreview');
    if (button) { button.textContent = 'Preview walk'; button.setAttribute('aria-pressed', 'false'); }
  }

  function toggleLongoranWalk() {
    if (longoranWalkTimer) { stopLongoranWalk(); return; }
    if (!active || selected?.species !== 'longoran') return;
    const button = document.getElementById('maaLongoranWalkPreview');
    if (button) { button.textContent = 'Stop walk'; button.setAttribute('aria-pressed', 'true'); }
    longoranWalkTimer = setInterval(() => {
      if (!active || selected?.species !== 'longoran') { stopLongoranWalk(); return; }
      const entry = selected;
      entry.feet?.update?.(.05, 3.6, false, null, { speed: 3.6, velocityX: 0, velocityZ: 3.6, combat: false }); // Use the same walking-motion input contract as the enemy preview; enough speed to see the lurch.
      // Only the portrait pitches: the planted feet stay world-horizontal in the preview.
      if (entry.model) entry.model.rotation.x = Number(entry.feet?.getRunLean?.()) || 0; // Positive pitch matches the real gameplay body lean, not its backwards mirror.
    }, 50); // Author-only, opt-in 20 Hz preview; disposed on tab exit.
  }

  function exportLongoranTuning() {
    const data = { schema: 'hobunji.longoran-author-tuning.v1',
      note: 'Gender-specific spine/gait authored against the gameplay solvers; body x/y/head/offsetY remain in Full Character Scale export.',
      genders: window.HobunjiLongoranSpecies?.exportAuthorTuning?.() || {} };
    const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'longoran_author_tuning.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    status('Exported Longoran male/female spine and gait settings; this editor does not alter the repository until reviewed and committed.');
  }

  // Width/height/head/head-Y-offset are authored per species+gender, on the shared
  // profile — moving any one of these four sliders reapplies all four together
  // (each read fresh from its own range input) plus whatever age is already set.
  function applyBodyHeadSliders() {
    if (!active || !selected) return;
    const scale = { x: 1, y: 1, head: 1, offsetY: 0 };
    for (const [axis, field] of [['X', 'x'], ['Y', 'y'], ['Head', 'head']]) {
      const percent = clampPercent(document.getElementById(`maaFullScaleRange${axis}`).value);
      scale[field] = percent / 100;
      setSliderValue(axis, percent);
    }
    const offsetPercent = clampOffsetPercent(document.getElementById('maaFullScaleRangeOffsetY').value);
    scale.offsetY = offsetPercent / 100;
    setSliderValue('OffsetY', offsetPercent);
    selected.profile.anatomy ||= {};
    selected.profile.anatomy.rigScaleX = scale.x;
    selected.profile.anatomy.rigScaleY = scale.y;
    selected.profile.anatomy.headScale = scale.head;
    selected.profile.anatomy.headOffsetY = scale.offsetY;
    window.HobunjiCharacterRigScale?.applyToParent?.(selected.group, selected.species, selected.gender, scale, currentAgeFraction());
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistProfiles, 180);
  }

  // Age is per-NPC instance data, not species+gender-authored — it's stored and
  // persisted separately (see host().setNpcAge), and only ever composes with
  // whatever headOffsetY the selected character's profile already has.
  function applyAgeSlider() {
    if (!active || !selected?.npc?.id) return;
    const percent = clampAgePercent(document.getElementById('maaFullScaleRangeAge').value);
    setSliderValue('Age', percent);
    host()?.setNpcAge?.(selected.npc.id, percent / 100);
    const scale = window.HobunjiCharacterRigScale?.scaleFor?.(selected.species, selected.gender, selected.profile) || { x: 1, y: 1, head: 1, offsetY: 0 };
    window.HobunjiCharacterRigScale?.applyToParent?.(selected.group, selected.species, selected.gender, scale, percent / 100);
  }

  function persistProfiles() {
    clearTimeout(persistTimer);
    persistTimer = 0;
    try {
      const data = host()?.serializeRig?.() || {
        schema: 'hobunji.attachment-rig-profiles.v10',
        exportedAt: new Date().toISOString(),
        profiles: clone(window.HOBUNJI_ATTACHMENT_RIG_PROFILES || {}),
      };
      localStorage.setItem(RIG_SAVE_KEY, JSON.stringify(data));
    } catch (error) { console.warn('[full-character-scale] profile autosave failed', error); }
  }

  // Discards every author override — in-memory, both localStorage persistence keys,
  // and the authored fields on every live shared profile — then re-derives x/y/head/
  // offsetY straight from character-rig-scale-defaults.js and reapplies it to every
  // visible lineup avatar (not just the selected one). Also clears every per-NPC age
  // override, so "everything" really does mean the whole comparison, not just
  // whatever's currently picked.
  function resetAllToRepoDefaults() {
    if (!active) return;
    if (window.confirm && !window.confirm('Reset every species/gender scale, Longoran posture/gait, and every per-NPC age back to repository defaults? This discards local overrides.')) return;
    window.HobunjiLongoranSpecies?.resetAuthorTuning?.(); // Restores the same shipped defaults used by new Longoran spawns.
    const count = host()?.resetToRepositoryDefaults?.() || 0;
    for (const entry of entries) {
      const scale = window.HobunjiCharacterRigScale?.scaleFor?.(entry.species, entry.gender, entry.profile) || { x: 1, y: 1, head: 1, offsetY: 0 };
      window.HobunjiCharacterRigScale?.applyToParent?.(entry.group, entry.species, entry.gender, scale, 0);
      if (entry.species === 'longoran') { refreshLongoranSpine(entry); rebuildLongoranFeet(entry); }
    }
    window.ProceduralHandFrameDriver?.syncNow?.();
    if (selected) select(selected);
    persistProfiles();
    status(`Reset ${count} species/gender scale${count === 1 ? '' : 's'} and every per-NPC age to repository defaults.`);
  }

  function exportJson() {
    const data = {};
    for (const descriptor of profileDescriptors()) {
      const profile = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[descriptor.key];
      const scale = window.HobunjiCharacterRigScale?.scaleFor?.(descriptor.species, descriptor.gender, profile) || { x: 1, y: 1, head: 1, offsetY: 0 };
      data[descriptor.species] ||= {};
      data[descriptor.species][descriptor.gender] = {
        x: Math.round(scale.x * 10000) / 10000,
        y: Math.round(scale.y * 10000) / 10000,
        head: Math.round(scale.head * 10000) / 10000,
        offsetY: Math.round(scale.offsetY * 10000) / 10000,
      };
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

  function applyAnatomyConfig(profile) {
    const anatomy = profile?.anatomy || {};
    const species = normalizeSpecies(profile?.species);
    const gender = normalizeGender(profile?.gender);
    const pngConfig = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar;
    if (!species || !gender || !pngConfig) return;

    const placement = Number(anatomy.portraitVerticalPlacementRatio);
    if (Number.isFinite(placement)) {
      pngConfig.portraitVerticalPlacement ||= { default: .5 };
      pngConfig.portraitVerticalPlacement[species] ||= {};
      pngConfig.portraitVerticalPlacement[species][gender] = placement;
    }

    const portraitScale = Number(anatomy.portraitScale);
    if (Number.isFinite(portraitScale) && portraitScale > 0) {
      pngConfig.portraitScaleBySpecies ||= {};
      const legacy = Number(pngConfig.portraitScaleBySpecies[species]);
      const entry = typeof pngConfig.portraitScaleBySpecies[species] === 'object'
        ? pngConfig.portraitScaleBySpecies[species]
        : { default: Number.isFinite(legacy) && legacy > 0 ? legacy : 1 };
      entry[gender] = portraitScale;
      pngConfig.portraitScaleBySpecies[species] = entry;
    }

    const footScale = Number(anatomy.footScale);
    if (Number.isFinite(footScale) && footScale > 0) {
      pngConfig.proceduralFeet ||= {};
      pngConfig.proceduralFeet.footScale ||= { default: 1 };
      pngConfig.proceduralFeet.footScale[species] ||= {};
      pngConfig.proceduralFeet.footScale[species][gender] = footScale;
    }

    const handScale = Number(anatomy.handScale);
    if (Number.isFinite(handScale) && handScale > 0 && window.HobunjiHandModelProfiles?.mutate) {
      window.HobunjiHandModelProfiles.mutate(data => {
        data.speciesScaleOverrides ||= {};
        data.speciesScaleOverrides[species] ||= {};
        data.speciesScaleOverrides[species][gender] = handScale;
      });
    }
  }

  async function renderPortrait(canvas, profile, options) {
    const job = portraitRenderChain.then(() => window.NpcAvatarPreview.renderProfileToCanvas(canvas, profile, options));
    portraitRenderChain = job.catch(() => {});
    return job;
  }

  async function buildPortrait(npc) {
    await window.NpcAvatarPreview.ensurePortraitCosmetics({ assetBase: '../../assets/', configBase: '../../config/' });
    const exportNpc = portraitExportFor(npc);
    let profile = window.NpcAvatarPreview.buildProfileFromNpcExport(exportNpc);
    if (!profile) {
      profile = window.NpcAvatarPreview.randomProfile(`full-scale:${npc.id || npc.name}`, {
        speciesId: exportNpc.appearance.speciesId,
        gender: exportNpc.appearance.gender,
      });
    }
    if (!profile) throw new Error(`Could not build a portrait profile for ${npc.name || npc.id}.`);
    const size = Number(window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.previewPortraitCanvasSize) || 200;
    const front = Object.assign(document.createElement('canvas'), { width: size, height: size });
    const back = Object.assign(document.createElement('canvas'), { width: size, height: size });
    const head = Object.assign(document.createElement('canvas'), { width: size, height: size });
    await renderPortrait(front, profile, { seatId: npc.id || npc.name || 'full-scale', forceEyesOpen: true }); // Static model texture: suppress unused blink PNG requests.
    await renderPortrait(back, profile, { seatId: npc.id || npc.name || 'full-scale', portraitView: 'behind', forceEyesOpen: true }); // Preserve full rear cosmetics.
    // Same pattern the real game uses (see game.js's playerNeckJoint/NPC dialogue setup): a
    // head-only render lets buildSinglePlaneAvatarModel's neckRig option locate the head pixels
    // and skin-weight a neck bone for it. Without this, there is no bone for Full Character
    // Scale's Head slider to drive at all — it silently does nothing.
    await renderPortrait(head, profile, { seatId: npc.id || npc.name || 'full-scale', onlyHeadSprite: true, forceEyesOpen: true });
    return { exportNpc, profile, front, back, head };
  }

  function avatarBaseWidth() {
    const configured = Number(window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.worldModelWidth);
    return Number.isFinite(configured) && configured > 0 ? configured : 0.9;
  }

  async function buildPreviewEntry(rep, buildId) {
    const rigProfile = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[rep.key];
    if (!rigProfile) throw new Error(`Missing rig profile ${rep.key}.`);
    rigProfile.anatomy ||= {};
    const initialScale = window.HobunjiCharacterRigScale?.scaleFor?.(rep.species, rep.gender, rigProfile) || { x: 1, y: 1, head: 1, offsetY: 0 };
    rigProfile.anatomy.rigScaleX ??= initialScale.x;
    rigProfile.anatomy.rigScaleY ??= initialScale.y;
    rigProfile.anatomy.headScale ??= initialScale.head;
    rigProfile.anatomy.headOffsetY ??= initialScale.offsetY;
    applyAnatomyConfig(rigProfile);

    const avatar = await buildPortrait(rep.npc);
    if (buildId !== generation || !previewRoot) return null; // Exiting mid-network-load must never attach a stale mesh to a disposed comparison scene.
    const group = new THREE.Group(); // Preview-only parent used by portrait, hands, feet, and whole-character scale together.
    group.name = `FullScalePreview_${rep.key}`;
    group.userData.fullScalePreviewKey = rep.key;

    const baseWidth = avatarBaseWidth();
    const model = window.PNGPlaneAvatar.buildSinglePlaneAvatarModel(THREE, avatar.front, {
      backCanvas: avatar.back,
      headCanvas: avatar.head,
      neckRig: true, // Without this, buildSinglePlaneAvatarModel never builds a neck bone, and the Head slider (which only ever drives that bone — see applyHeadCompensation) has nothing to act on.
      profile: avatar.profile,
      appearance: avatar.exportNpc.appearance,
      npcRecord: rep.npc,
      modelWidth: baseWidth,
      modelHeight: baseWidth,
      name: `${group.name}_portrait`,
      userData: { source: 'full-character-scale-preview', nonInteractive: true, npcId: rep.npc.id || null },
    });
    model.userData.proceduralHandParent = group; // Exact Rig reference-NPC contract: the normal free-hand runtime owns hand placement under this floor-relative parent.
    model.userData.rigAvatarProfile = avatar.profile;
    group.add(model);

    const modelHeight = Number(model.userData.portraitModelHeight) || 1;
    const modelWidth = Number(model.userData.portraitModelWidth) || modelHeight;
    model.position.y = modelHeight / 2;

    const feet = window.ProceduralLegAnimation?.attach?.(THREE, group, {
      speciesId: rep.species,
      gender: rep.gender,
      bodyColors: avatar.profile?.bodyColors || avatar.exportNpc.appearance?.bodyColors,
      modelWidth,
      modelHeight,
      handAttachY: model.userData.handAttachY,
      name: `${group.name}_feet`,
      profile: avatar.profile,
      ...(rep.species === 'longoran' ? { spine: window.HobunjiLongoranSpecies?.spineFor?.(rep.gender), gaitProfile: window.HobunjiLongoranSpecies?.gaitFor?.(rep.gender) } : {}), // Uses the identical authored gait when building the lineup.
      portraitSize: avatar.front.width || 200,
    }) || null;
    feet?.update?.(0, 0, false, null);

    previewRoot.add(group);
    const ageFraction = rep.npc?.id ? (host()?.npcAgeFor?.(rep.npc.id) || 0) : 0;
    window.HobunjiCharacterRigScale?.applyToParent?.(group, rep.species, rep.gender, {
      x: rigProfile.anatomy.rigScaleX, y: rigProfile.anatomy.rigScaleY, head: rigProfile.anatomy.headScale, offsetY: rigProfile.anatomy.headOffsetY,
    }, ageFraction);
    window.ProceduralHandFrameDriver?.syncNow?.();
    const entry = { ...rep, group, model, feet, profile: rigProfile, avatarProfile: avatar.profile };
    if (rep.species === 'longoran') refreshLongoranSpine(entry); // Gameplay-static back curvature is visible on the initial lineup, not only after touching a slider.
    return entry;
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

  function layout() {
    if (!THREE || !entries.length || !previewRoot) return;
    if (chair) chair.parent?.remove?.(chair);
    let cursor = 0;
    for (const entry of entries) {
      entry.group.position.set(0,0,0);
      entry.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(entry.group);
      const width = Math.max(0.45, box.getSize(new THREE.Vector3()).x);
      const centerX = box.getCenter(new THREE.Vector3()).x;
      entry._lineX = cursor + width / 2 - centerX;
      cursor += width + 0.34;
    }
    if (chair) {
      previewRoot.add(chair);
      chair.position.set(cursor + 0.48,0,0);
      chair.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(chair);
      const width = Math.max(0.45, box.getSize(new THREE.Vector3()).x);
      chair.position.x += width / 2 - box.getCenter(new THREE.Vector3()).x;
      cursor += 0.48 + width;
    }
    const shift = cursor / 2;
    for (const entry of entries) entry.group.position.x = entry._lineX - shift;
    if (chair) chair.position.x -= shift;
    previewRoot.updateMatrixWorld(true);
  }

  function focusSelected() {
    if ((!active && !building) || !THREE || !selected?.group) return;
    manualViewInteraction = true; // Explicit camera requests win over the deferred auto-fit at the end of loading.
    focusedEntryKey = selected.key; // Explicit user action: keep this focus even if a different character is selected for editing.
    if (window.HobunjiFullScaleEditorPresentation?.frameOrthographic) {
      window.HobunjiFullScaleEditorPresentation.frameOrthographic(true, true); // The shared orthographic owner centers and sizes the chosen preview exactly once.
    } else {
      const camera = window.HobunjiGameplayBackdrop?.getCamera?.();
      if (!camera) return;
      const box = new THREE.Box3().setFromObject(selected.group); // Perspective fallback for tools without the orthographic adapter.
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const canvas = document.getElementById('view3d');
      const aspect = Math.max(0.1, Number(camera.aspect) || ((canvas?.clientWidth || 1) / Math.max(1, canvas?.clientHeight || 1)));
      const verticalFov = THREE.MathUtils.degToRad(Number(camera.fov) || 50);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
      const byWidth = (size.x / 2 + 0.3) / Math.max(0.01, Math.tan(horizontalFov / 2));
      const byHeight = (size.y / 2 + 0.3) / Math.max(0.01, Math.tan(verticalFov / 2));
      const distance = Math.max(1.5, byWidth, byHeight) * 1.25 + size.z / 2;
      const angleX = selected.species === 'longoran' ? distance * 0.7 : 0; // Longoran depth curvature is only exposed when explicitly focused.
      camera.position.set(center.x + angleX, center.y + (angleX ? distance * 0.1 : 0), center.z + distance);
      camera.lookAt(center);
      const controls = window.HobunjiGameplayBackdrop?.getCameraControls?.(); // Perspective fallback still orbits the explicitly focused character.
      controls?.target?.copy?.(center);
      controls?.update?.();
      camera.updateMatrixWorld?.(true);
    }
    status(`Focused ${prettySpecies(selected.species)} ${selected.gender}. Camera stays put while editing; Frame lineup returns to the whole comparison.`);
  }

  function frame() {
    if ((!active && !building) || !THREE || !previewRoot) return;
    focusedEntryKey = null; // Only an explicit Frame lineup action clears the previously chosen camera focus.
    if (window.HobunjiFullScaleEditorPresentation?.frameOrthographic) {
      window.HobunjiFullScaleEditorPresentation.frameOrthographic(true, true);
      return;
    }
    const camera = window.HobunjiGameplayBackdrop?.getCamera?.();
    if (!camera) return;
    const box = new THREE.Box3().setFromObject(previewRoot);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const canvas = document.getElementById('view3d');
    const aspect = Math.max(0.1, Number(camera.aspect) || ((canvas?.clientWidth || 1) / Math.max(1, canvas?.clientHeight || 1)));
    const verticalFov = THREE.MathUtils.degToRad(Number(camera.fov) || 50);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const byWidth = (size.x / 2 + 0.35) / Math.max(0.01, Math.tan(horizontalFov / 2));
    const byHeight = (size.y / 2 + 0.3) / Math.max(0.01, Math.tan(verticalFov / 2));
    const distance = Math.max(1.6, byWidth, byHeight) * 1.12 + size.z / 2;
    const targetY = Math.max(center.y, size.y * 0.42);
    camera.position.set(center.x, targetY + Math.min(0.2, size.y * 0.08), center.z + distance);
    camera.lookAt(center.x, targetY, center.z);
    const controls = window.HobunjiGameplayBackdrop?.getCameraControls?.(); // Perspective fallback resets the orbit pivot with the whole lineup.
    controls?.target?.set?.(center.x, targetY, center.z);
    controls?.update?.();
    camera.updateMatrixWorld?.(true);
  }

  function pickAt(clientX, clientY) {
    if (!active || !THREE || !entries.length) return;
    const camera = window.HobunjiGameplayBackdrop?.getCamera?.();
    const canvas = document.getElementById('view3d');
    const rect = canvas?.getBoundingClientRect?.();
    if (!camera || !rect?.width || !rect?.height) return;
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    let best = null;
    for (const entry of entries) {
      const hit = raycaster.intersectObject(entry.group, true)[0];
      if (hit && (!best || hit.distance < best.distance)) best = { entry, distance: hit.distance };
    }
    if (best?.entry) select(best.entry);
  }

  function preserveMultiSave() {
    if (!savedMulti) return;
    try { localStorage.setItem(MULTI_SAVE_KEY, JSON.stringify(savedMulti)); } catch (_) {}
  }

  async function buildLineup(buildId) {
    const reps = await representatives();
    const ordered = [
      ...reps.filter(item => item.species === 'longoran'),
      ...reps.filter(item => item.species !== 'longoran'),
    ]; // Show the species currently being authored first, without dropping or duplicating the other comparison entries.
    const missing = ordered.filter(item => !item.npc);
    if (missing.length) status(`Missing preview NPC: ${missing.map(item => item.key).join(', ')}`);
    entries = [];
    const expected = ordered.filter(item => item.npc).length; // The mobile progress text counts only buildable representatives.

    THREE = (await window.PNGPlaneAvatar?.loadThreeModules?.())?.THREE || null;
    if (buildId !== generation) return;
    if (!THREE) throw new Error('Three.js is unavailable.');
    const scene = window.HobunjiGameplayBackdrop?.getScene?.();
    if (!scene) throw new Error('Animation Author backdrop scene is unavailable.');
    if (!window.NpcAvatarPreview || !window.ProceduralLegAnimation || !window.ProceduralHandFrameDriver) {
      throw new Error('Rig preview hand/foot runtime is unavailable.');
    }

    previewRoot = new THREE.Group();
    previewRoot.name = 'FullCharacterScalePreviewRoot';
    previewRoot.userData.fullCharacterScalePreviewOnly = true;
    scene.add(previewRoot);
    const chooser = document.getElementById('maaFullScaleChoose'); // Options appear as soon as their actual preview meshes are ready.
    chooser?.replaceChildren();

    for (const rep of ordered) {
      if (buildId !== generation) return;
      if (!rep.npc) continue;
      status(`Loading ${entries.length + 1}/${expected}: ${prettySpecies(rep.species)} ${rep.gender} (ready previews remain editable)…`);
      let entry;
      try { entry = await buildPreviewEntry(rep, buildId); }
      catch (error) {
        if (buildId !== generation) return;
        console.warn('[full-character-scale] skipped unrenderable species preview', rep.key, error);
        status(`Skipped ${prettySpecies(rep.species)} ${rep.gender}: ${error.message}`);
        continue; // One missing optional species asset must not discard all successfully rendered comparisons.
      }
      if (buildId !== generation || !entry) return;
      entries.push(entry);
      if (chooser) {
        const option = document.createElement('option');
        option.value = entry.key;
        option.textContent = `${prettySpecies(entry.species)} · ${entry.gender}`;
        chooser.appendChild(option);
      }
      if (!selected) {
        active = true; // The first Longoran becomes tweakable without waiting for every other species image.
        layout();
        select(entry); // The first Longoran can be edited immediately, without forcing a new camera angle.
        frame(); // Establish one initial framing; later edits and background loading must not move the camera.
      } else {
        layout(); // Every newly loaded character receives its own slot immediately; never overlap previews while images stream.
        // Background portrait arrivals can reposition models, but must never override a user's camera orbit or zoom.
      }
      chrome();
      await new Promise(resolve => setTimeout(resolve, 0)); // Yield a paint opportunity on mobile rather than monopolizing the UI between portraits.
    }
    if (buildId !== generation) return;
    if (!entries.length) throw new Error('No repository character previews could be built.');

    const finishedChair = await buildChair();
    if (buildId !== generation) return;
    chair = finishedChair;
    layout();
    // The final chair/layout must not undo manually chosen camera orientation or placement.
    window.ProceduralHandFrameDriver?.syncNow?.();
    // Do not automatically reframe after all backgrounds finish: a player may already be editing
    // Longoran or inspecting a specific face. The existing Frame lineup action shows everyone.
    if (!selected) select(entries[0]);
    if (!manualViewInteraction) frame(); // Initial auto-fit only after all previews arrive, and never after edits, gestures or explicit focus.
    status(`All ${entries.length}/${expected} species/gender previews ready. Use Frame lineup to see everyone.`);
    setTimeout(preserveMultiSave, 350);
  }

  function disposePreview() {
    stopLongoranWalk();
    clearTimeout(longoranFeetTimer);
    longoranFeetTimer = 0;
    focusedEntryKey = null;
    manualViewInteraction = false; // A new editor session starts with a fresh no-interaction initial camera fit.
    selected = null;
    const focusButton = document.getElementById('maaFullScaleFocus');
    if (focusButton) focusButton.disabled = true;
    for (const entry of entries) {
      try { entry.feet?.dispose?.(); } catch (_) {}
      try { window.PNGPlaneAvatar?.disposeAvatarModel?.(entry.model); } catch (_) {}
      try { entry.group?.parent?.remove?.(entry.group); } catch (_) {}
    }
    entries = [];
    if (chair) {
      try { chair.parent?.remove?.(chair); } catch (_) {}
      chair.traverse?.(node => {
        try { node.geometry?.dispose?.(); } catch (_) {}
        try { node.material?.dispose?.(); } catch (_) {}
      });
      chair = null;
    }
    if (previewRoot) {
      try { previewRoot.parent?.remove?.(previewRoot); } catch (_) {}
      previewRoot = null;
    }
    window.ProceduralHandFrameDriver?.syncNow?.();
  }

  async function enter() {
    if (active || building || !ensureUi()) return;
    building = true;
    const buildId = ++generation;
    originMode = ['multi','single','rig'].includes(document.body.dataset.animationAuthorMode) ? document.body.dataset.animationAuthorMode : 'multi';
    try {
      const scaleHost = host();
      if (!scaleHost) throw new Error('Full Character Scale host is unavailable.');
      if (originMode !== 'multi') await scaleHost.setMode('multi');
      savedMulti = clone(window.MultiAvatarAnimationAuthor?.exportProject?.());
      if (!savedMulti) throw new Error('Could not snapshot the multi-avatar workspace.');
      preserveMultiSave();
      await scaleHost.clearActors();
      chrome();
      status('Building preview-only species/gender lineup…');
      await buildLineup(buildId);
      if (buildId !== generation) return;
      building = false;
      active = true;
      chrome();
      status('Tap/click any character to select its own species/gender scale. Hands and feet use the Rig Coordinates preview runtime.');
    } catch (error) {
      console.warn('[full-character-scale]', error);
      building = false;
      active = false;
      status(`Could not build scale comparison: ${error.message}`);
      disposePreview();
      await restore(originMode);
    }
  }

  async function restore(targetMode) {
    disposePreview();
    if (savedMulti) {
      try { await window.MultiAvatarAnimationAuthor?.importProject?.(clone(savedMulti)); }
      catch (error) { console.warn('[full-character-scale] multi restore failed', error); }
      preserveMultiSave();
    }
    if (targetMode && targetMode !== 'multi') await host()?.setMode?.(targetMode);
    document.getElementById(TAB_ID)?.setAttribute('aria-selected','false');
  }

  async function exit(targetMode = originMode) {
    if (!active && !building) return;
    ++generation;
    active = false;
    building = false;
    persistProfiles();
    await restore(targetMode || originMode || 'multi');
    savedMulti = null;
  }

  function install() {
    if (!ensureUi()) return false;
    window.HobunjiFullCharacterScaleComparison = Object.freeze({
      enter,
      exit,
      exportJson,
      get active() { return active; },
      get selectedKey() { return selected?.key || null; },
      get focusKey() { return focusedEntryKey; }, // Independent of selectedKey: choosing a different editor target must never move the camera.
      get previewCount() { return entries.length; },
      debugSnapshot: () => ({
        active,
        building,
        lineup: entries.map(entry => entry.key),
        selected: selected?.key || null, // Identifies which progressively loaded species is currently editable.
        view: focusedEntryKey ? 'focused-character' : 'lineup', // Mobile diagnostics report the explicitly chosen camera mode.
        focused: focusedEntryKey, // Identifies the focused portrait even when a different character is selected.
        spinePreviewApplied: selected?.species === 'longoran' ? !!selected.spinePreviewApplied : null, // Detects missing skinned rigs without devtools.
        gait: selected?.species === 'longoran' ? selected.feet?.getStandingPoseDebug?.()?.gait || null : null, // Exposes actual Maskbound gait state in the preview.
        portraitLoading: window.__portraitPixelCacheDebug?.()?.imageLoads || null, // Displays slowest sprite and real request counts without devtools.
        portraitImageCache: window.__portraitPixelCacheDebug?.()?.images || null, // Cache size and evictions distinguish reload churn from network slowness.
        latestChange: 'Longoran spine hunch/kyphosis is visible above body scales without nested clipping; arm length offset remains in Rig Coordinates.',
      }),
    });
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    const ready = !!window.MultiAvatarAnimationAuthor
      && !!host()
      && !!window.HobunjiCharacterRigScale
      && !!window.NpcAvatarPreview
      && !!window.PNGPlaneAvatar
      && !!window.ProceduralLegAnimation
      && !!window.ProceduralHandFrameDriver;
    if ((ready && install()) || ++attempts >= 600) clearInterval(timer);
  }, 50);
  install();
})();
