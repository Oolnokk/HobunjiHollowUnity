// Shared portrait-X authoring/runtime support for Full Character Scale.
(() => {
  'use strict';

  const TOOL = /\/tools\/animation-author\/(?:index\.html)?$/;
  const SAVE_KEY = 'hobunjiAttachmentRigProfiles.v2';
  const RANGE_ID = 'maaFullScaleRangePortraitOffsetX';
  const NUMBER_ID = 'maaFullScaleNumPortraitOffsetX';
  const MAX = 0.5;
  const EPS = 1e-9;
  let scaleApi = null; // Wrapped shared scale API used by runtime and the authoring preview.
  let hostApi = null; // Wrapped Full Character Scale host used only inside Animation Author.
  let panelBound = null; // Prevents duplicate listeners if the comparison panel is rebuilt.
  let saveTimer = 0; // Debounces the existing rig-profile autosave while dragging.
  let lastSelection = ''; // Keeps the injected control synchronized when the selected species/gender changes.

  const clamp = value => {
    const n = Number(value); // Normalized authored fraction stored on the shared anatomy profile.
    return Number.isFinite(n) ? Math.max(-MAX, Math.min(MAX, n)) : 0;
  };
  const speciesKey = value => {
    let species = String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-'); // Canonical species key used by shared rig profiles.
    if (typeof window.hobunjiTransformSpeciesId === 'function') species = window.hobunjiTransformSpeciesId(species);
    else if (species === 'rakakoan') species = 'kenkari';
    else if (species === 'ghoul') species = 'mao-ao';
    return String(species || '').toLowerCase();
  };
  const genderKey = value => String(value || '').toLowerCase() === 'f' ? 'female' : (String(value || '').toLowerCase() === 'm' ? 'male' : String(value || '').toLowerCase());
  const profileFor = (species, gender) => window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[`${speciesKey(species)}::${genderKey(gender)}`] || null;
  const offsetFor = (species, gender, profile = null) => clamp((profile || profileFor(species, gender))?.anatomy?.portraitOffsetX);

  function portraitNode(root) {
    let found = null; // First portrait-bearing local root; hands/feet live outside this node under the floor parent.
    const inspect = node => {
      if (found || !node?.position || !node.userData) return;
      const width = Number(node.userData.portraitModelWidth); // Preferred width basis written by PNGPlaneAvatar.
      const height = Number(node.userData.portraitModelHeight); // Fallback for older portrait roots.
      if ((Number.isFinite(width) && width > 0) || (Number.isFinite(height) && height > 0) || node.userData.neckRig) {
        found = { node, width: Number.isFinite(width) && width > 0 ? width : (Number.isFinite(height) && height > 0 ? height : 1) };
      }
    };
    inspect(root);
    if (!found) for (const child of root?.children || []) inspect(child);
    if (!found) root?.traverse?.(inspect);
    return found;
  }

  function applyPortraitX(root, species, gender, explicit = null) {
    const found = portraitNode(root);
    if (!found) return false;
    const supplied = Number(explicit?.portraitOffsetX); // Explicit authoring tuple wins; otherwise use the live species/gender profile.
    const fraction = Number.isFinite(supplied) ? clamp(supplied) : offsetFor(species, gender);
    const state = found.node.userData.hobunjiPortraitXOffsetState; // Previous result lets repeated edits reapply from the same baseline without drift.
    const current = Number(found.node.position.x) || 0;
    const base = state && Math.abs(current - Number(state.output)) <= EPS ? Number(state.base) : current;
    const output = base + fraction * found.width;
    found.node.position.x = output;
    found.node.userData.hobunjiPortraitXOffsetState = { base, output, fraction, width: found.width, units: 'portrait-width-fraction' };
    found.node.updateMatrix?.();
    found.node.updateMatrixWorld?.(true);
    return true;
  }

  function installScaleApi() {
    const base = window.HobunjiCharacterRigScale; // Existing x/y/head/head-Y implementation remains authoritative.
    if (!base?.scaleFor || !base?.applyToParent) return false;
    if (base.__portraitXOffsetV1) { scaleApi = base; return true; }
    const scaleFor = (species, gender, profile = null) => ({ ...base.scaleFor(species, gender, profile), portraitOffsetX: offsetFor(species, gender, profile) });
    const applyToParent = (parent, species, gender, explicit = null, age = 0) => {
      const result = base.applyToParent(parent, species, gender, explicit, age);
      applyPortraitX(parent, species, gender, explicit);
      return result;
    };
    const clearFromParent = parent => {
      const found = portraitNode(parent); // Restores the portrait's authored local X before clearing the existing body/head transform.
      const state = found?.node?.userData?.hobunjiPortraitXOffsetState;
      if (state && Number.isFinite(Number(state.base))) {
        found.node.position.x = Number(state.base);
        delete found.node.userData.hobunjiPortraitXOffsetState;
      }
      return base.clearFromParent?.(parent) ?? true;
    };
    scaleApi = Object.freeze({ ...base, __portraitXOffsetV1: true, scaleFor, applyToParent, clearFromParent, applyPortraitXOffset: applyPortraitX, maxPortraitOffsetFraction: MAX });
    window.HobunjiCharacterRigScale = scaleApi;
    return true;
  }

  function installAvatarRuntime() {
    const avatars = window.PNGPlaneAvatar; // Shared constructor used by game characters and Full Character Scale previews.
    if (!scaleApi || !avatars?.buildSinglePlaneAvatarModel) return false;
    const current = avatars.buildSinglePlaneAvatarModel;
    if (current.__portraitXOffsetV1) return true;
    const wrapped = function portraitXAvatarBuild(THREE, canvas, options = {}) {
      const root = current.apply(this, arguments);
      const appearance = options.appearance || options.profile?.appearance || options.npcRecord?.appearance || {}; // Same identity sources used by the existing head runtime.
      const species = options.speciesId || appearance.speciesId || appearance.species || options.profile?.speciesId || options.profile?.species;
      const gender = options.gender || appearance.gender || options.profile?.gender || 'male';
      if (root && species) {
        const resolved = scaleApi.scaleFor(species, gender);
        const applied = scaleApi.applyPortraitXOffset(root, species, gender, resolved);
        root.userData ||= {};
        root.userData.hobunjiPortraitXOffsetRuntime = { applied: !!applied, species, gender, portraitOffsetX: resolved.portraitOffsetX }; // Mobile-visible per-avatar diagnostic.
      }
      return root;
    };
    Object.assign(wrapped, current);
    wrapped.__portraitXOffsetV1 = true;
    avatars.buildSinglePlaneAvatarModel = wrapped;
    return true;
  }

  function restoreAutosave() {
    try {
      const data = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); // Reuses the existing rig autosave; there is no parallel portrait-offset store.
      const characters = (data?.profiles || data?.attachmentRigProfiles || data)?.characters || {};
      for (const [key, source] of Object.entries(characters)) {
        const [species, gender] = key.split('::');
        const value = Number(source?.anatomy?.portraitOffsetX);
        const target = profileFor(source?.species || species, source?.gender || gender);
        if (target && Number.isFinite(value)) {
          target.anatomy ||= {};
          target.anatomy.portraitOffsetX = clamp(value);
        }
      }
    } catch (_) {}
  }

  function overlayExport(data) {
    const characters = (data?.profiles || data?.attachmentRigProfiles || data)?.characters || {}; // Native/shared rig profiles receiving the live portrait offset.
    for (const [key, profile] of Object.entries(characters)) {
      const [species, gender] = key.split('::');
      profile.anatomy ||= {};
      profile.anatomy.portraitOffsetX = offsetFor(profile.species || species, profile.gender || gender);
    }
    if (data?.schema === 'hobunji.attachment-rig-profiles.v10') {
      data.anatomySemantics ||= {};
      data.anatomySemantics.portraitOffsetX = 'Portrait-only X offset, fraction of portrait model width; hands/feet/attachment coordinates remain on the floor-relative rig parent.';
      data.fullCharacterScaleRoundTripVersion = Math.max(4, Number(data.fullCharacterScaleRoundTripVersion) || 0);
    }
    return data;
  }

  function installHost() {
    if (!TOOL.test(location.pathname)) return true;
    const base = window.HobunjiAnimationAuthorScaleHost || window.HobunjiAnimationAuthorHost; // Existing durable Full Character Scale host.
    if (!base?.setRigScale || !base?.serializeRig) return false;
    if (base.__portraitXOffsetV1) { hostApi = base; return true; }
    restoreAutosave();
    const setRigScale = (species, gender, value, options) => {
      const profile = profileFor(species, gender); // Preserves the current portrait offset when legacy four-field callers edit width/height/head/head-Y.
      const supplied = Number(value?.portraitOffsetX);
      const offset = Number.isFinite(supplied) ? clamp(supplied) : offsetFor(species, gender, profile);
      const result = base.setRigScale(species, gender, value, options);
      if (profile) { profile.anatomy ||= {}; profile.anatomy.portraitOffsetX = offset; }
      return { ...(result || value || {}), portraitOffsetX: offset };
    };
    const serializeRig = () => overlayExport(base.serializeRig());
    const resetToRepositoryDefaults = () => {
      for (const profile of Object.values(window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {})) if (profile?.anatomy) delete profile.anatomy.portraitOffsetX;
      return base.resetToRepositoryDefaults?.() || 0;
    };
    hostApi = Object.freeze({ ...base, __portraitXOffsetV1: true, setRigScale, serializeRig, resetToRepositoryDefaults });
    window.HobunjiAnimationAuthorScaleHost = hostApi;
    window.HobunjiAnimationAuthorHost = hostApi;
    return true;
  }

  function selected() {
    const key = String(window.HobunjiFullCharacterScaleComparison?.selectedKey || ''); // Public comparison selection key.
    const [species, gender] = key.split('::');
    return species && gender ? { key, species, gender } : null;
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { if (hostApi) localStorage.setItem(SAVE_KEY, JSON.stringify(hostApi.serializeRig())); } catch (error) { console.warn('[full-character-scale] portrait X autosave failed', error); }
    }, 180);
  }

  function applyPercent(percent) {
    const id = selected();
    const profile = id && profileFor(id.species, id.gender);
    if (!id || !profile || !scaleApi || !hostApi) return;
    const next = { ...scaleApi.scaleFor(id.species, id.gender, profile), portraitOffsetX: clamp(Number(percent) / 100) };
    const persisted = hostApi.setRigScale(id.species, id.gender, next) || next;
    const group = window.HobunjiGameplayBackdrop?.getScene?.()?.getObjectByName?.(`FullScalePreview_${id.key}`); // Selected preview updates immediately.
    let age = 0; // Existing per-NPC hunch must survive a portrait-only X edit.
    let npcId = null; // Resolved from the preview model's mobile-visible NPC metadata.
    group?.traverse?.(node => { if (!npcId && node?.userData?.npcId) npcId = node.userData.npcId; });
    if (npcId) age = Number(hostApi.npcAgeFor?.(npcId)) || 0;
    if (group) scaleApi.applyToParent(group, id.species, id.gender, persisted, age);
    saveSoon();
    lastSelection = '';
  }

  function exportScales() {
    const out = {}, seen = new Set(); // Same canonical species/gender grouping as the existing Full Character Scale export.
    for (const [key, profile] of Object.entries(window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {})) {
      const [rawSpecies, rawGender] = key.split('::');
      const species = speciesKey(profile?.species || rawSpecies), gender = genderKey(profile?.gender || rawGender), canonical = `${species}::${gender}`;
      if (!species || !gender || seen.has(canonical)) continue;
      seen.add(canonical);
      const s = scaleApi.scaleFor(species, gender, profile);
      out[species] ||= {};
      out[species][gender] = { x: s.x, y: s.y, head: s.head, offsetY: s.offsetY, portraitOffsetX: s.portraitOffsetX };
    }
    const blob = new Blob([JSON.stringify(out, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); // Existing browser-download path, now with portraitOffsetX included.
    a.href = url; a.download = 'hobunji_full_character_scales.json'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function installUi() {
    if (!TOOL.test(location.pathname) || !scaleApi || !hostApi) return !TOOL.test(location.pathname);
    const panel = document.getElementById('maaFullScalePanel');
    if (!panel) return false;
    let range = document.getElementById(RANGE_ID), number = document.getElementById(NUMBER_ID);
    if (!range || !number) {
      const anchor = document.getElementById('maaFullScaleRangeOffsetY')?.closest?.('.scaleRow'); // Portrait offset sits beside the existing authored head offset.
      if (!anchor) return false;
      const row = document.createElement('div');
      row.className = 'scaleRow';
      row.innerHTML = `<label for="${RANGE_ID}">Portrait X offset</label><input id="${RANGE_ID}" type="range" min="-50" max="50" step="0.5" value="0" aria-label="Portrait X offset, percent of portrait model width"><input id="${NUMBER_ID}" type="number" min="-50" max="50" step="0.5" value="0" aria-label="Portrait X offset, percent of portrait model width (exact value)">%`;
      anchor.insertAdjacentElement('afterend', row); range = row.querySelector(`#${RANGE_ID}`); number = row.querySelector(`#${NUMBER_ID}`);
    }
    if (panelBound !== panel) {
      panelBound = panel;
      range.addEventListener('input', () => { number.value = range.value; applyPercent(range.value); });
      number.addEventListener('input', () => { const n = Number(number.value); if (Number.isFinite(n) && n >= -50 && n <= 50) { range.value = String(n); applyPercent(n); } });
      number.addEventListener('change', () => { const n = Math.max(-50, Math.min(50, Number(number.value) || 0)); number.value = String(n); range.value = String(n); applyPercent(n); });
      panel.addEventListener('click', event => { if (event.target?.id === 'maaFullScaleExport') { event.preventDefault(); event.stopImmediatePropagation(); exportScales(); } }, true);
    }
    return true;
  }

  function syncUi() {
    if (!TOOL.test(location.pathname) || document.body?.dataset?.animationAuthorMode !== 'scale-compare' || !installUi()) return;
    const id = selected();
    if (!id) return;
    const value = offsetFor(id.species, id.gender) * 100, signature = `${id.key}|${value}`;
    const number = document.getElementById(NUMBER_ID);
    if (signature === lastSelection || document.activeElement === number) return;
    lastSelection = signature;
    const range = document.getElementById(RANGE_ID); if (range) range.value = String(value); if (number) number.value = String(Math.round(value * 10) / 10);
  }

  function diagnostics() {
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.fullCharacterPortraitXOffset = { installed: !!scaleApi, runtimeAvatarHook: !!window.PNGPlaneAvatar?.buildSinglePlaneAvatarModel?.__portraitXOffsetV1, toolHostWrapped: !!hostApi, uiInstalled: !!document.getElementById?.(RANGE_ID), profileField: 'anatomy.portraitOffsetX', units: 'portrait-width-fraction', autosaveKey: SAVE_KEY };
  }

  function install() {
    const ok = installScaleApi() && installAvatarRuntime() && installHost();
    installUi(); syncUi(); diagnostics();
    return ok;
  }

  let attempts = 0; // Bounded dependency bootstrap; tool selection sync stays lightweight after installation.
  const bootstrap = setInterval(() => { if (install() || ++attempts >= 600) clearInterval(bootstrap); }, 50);
  install();
  if (TOOL.test(location.pathname)) setInterval(syncUi, 100);
})();
