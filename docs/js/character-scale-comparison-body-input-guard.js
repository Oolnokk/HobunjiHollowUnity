// Full Character Scale body-input guard.
//
// character-scale-comparison.js historically reapplies X/Y/Head/Head-Y together
// whenever any one control changes. The raw-PNG Head presentation adapter makes
// that unsafe because the visible Head percentage is not the runtime headScale
// percentage. Own Width/Height/Head-Y input here and update only the requested
// field, preserving headScale byte-for-byte.
(() => {
  'use strict';

  if (!/\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname)) return;

  const MODE = 'scale-compare'; // Scopes the interception to Full Character Scale mode only.
  const PANEL_ID = 'maaFullScalePanel'; // Existing comparison control panel.
  const RIG_SAVE_KEY = 'hobunjiAttachmentRigProfiles.v2'; // Same autosave key used by the editor.
  const BODY_FIELDS = Object.freeze({
    maaFullScaleRangeX: Object.freeze({ field: 'x', pair: 'maaFullScaleNumX', min: 10, max: 400, number: false }),
    maaFullScaleNumX: Object.freeze({ field: 'x', pair: 'maaFullScaleRangeX', min: 10, max: 400, number: true }),
    maaFullScaleRangeY: Object.freeze({ field: 'y', pair: 'maaFullScaleNumY', min: 10, max: 400, number: false }),
    maaFullScaleNumY: Object.freeze({ field: 'y', pair: 'maaFullScaleRangeY', min: 10, max: 400, number: true }),
    maaFullScaleRangeOffsetY: Object.freeze({ field: 'offsetY', pair: 'maaFullScaleNumOffsetY', min: -50, max: 50, number: false }),
    maaFullScaleNumOffsetY: Object.freeze({ field: 'offsetY', pair: 'maaFullScaleRangeOffsetY', min: -50, max: 50, number: true }),
  });

  let installedPanel = null; // Prevents duplicate capture listeners if the workspace is rebuilt.
  let persistTimer = 0; // Debounces local rig autosaves while dragging a slider.

  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value)));

  function comparisonApi() {
    return window.HobunjiFullCharacterScaleComparison || null;
  }

  function selectedIdentity() {
    const key = String(comparisonApi()?.selectedKey || ''); // Resolves the currently edited canonical species/gender profile.
    const [species, gender] = key.split('::');
    return species && gender ? { key, species, gender } : null;
  }

  function profileFor(identity) {
    return identity ? window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[identity.key] || null : null;
  }

  function currentScale(identity) {
    return window.HobunjiCharacterRigScale?.scaleFor?.(identity?.species, identity?.gender, profileFor(identity))
      || { x: 1, y: 1, head: 1, offsetY: 0 };
  }

  function nextScalePreservingHead(current, field, percent) {
    const next = {
      x: Number(current?.x) || 1,
      y: Number(current?.y) || 1,
      head: Number(current?.head) || 1,
      offsetY: Number(current?.offsetY) || 0,
    }; // Head is copied first and is never derived from the visible Head control.
    if (field === 'x' || field === 'y') next[field] = Number(percent) / 100;
    else if (field === 'offsetY') next.offsetY = Number(percent) / 100;
    return next;
  }

  function previewGroupFor(identity) {
    return window.HobunjiGameplayBackdrop?.getScene?.()?.getObjectByName?.(`FullScalePreview_${identity?.key}`) || null;
  }

  function ageFractionFor(group) {
    let npcId = null; // Filled from the preview avatar's existing userData so age hunch survives body edits.
    group?.traverse?.(node => { if (!npcId && node?.userData?.npcId) npcId = node.userData.npcId; });
    const host = window.HobunjiAnimationAuthorScaleHost || window.HobunjiAnimationAuthorHost;
    return npcId ? (Number(host?.npcAgeFor?.(npcId)) || 0) : 0;
  }

  function persistProfilesSoon() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = 0;
      try {
        const host = window.HobunjiAnimationAuthorScaleHost || window.HobunjiAnimationAuthorHost;
        const data = host?.serializeRig?.() || {
          schema: 'hobunji.attachment-rig-profiles.v10',
          exportedAt: new Date().toISOString(),
          profiles: JSON.parse(JSON.stringify(window.HOBUNJI_ATTACHMENT_RIG_PROFILES || {})),
        };
        localStorage.setItem(RIG_SAVE_KEY, JSON.stringify(data));
      } catch (error) {
        console.warn('[full-character-scale] body autosave failed', error);
      }
    }, 180);
  }

  function applyBodyField(field, percent) {
    const identity = selectedIdentity();
    const profile = profileFor(identity);
    if (!identity || !profile) return null;
    const before = currentScale(identity);
    const next = nextScalePreservingHead(before, field, percent);
    profile.anatomy ||= {};
    if (field === 'x') profile.anatomy.rigScaleX = next.x;
    else if (field === 'y') profile.anatomy.rigScaleY = next.y;
    else profile.anatomy.headOffsetY = next.offsetY;
    // Deliberately DO NOT write profile.anatomy.headScale here. That field is
    // preserved from `before.head`, preventing the old raw-percent -> 400% bug.
    const group = previewGroupFor(identity);
    if (group) window.HobunjiCharacterRigScale?.applyToParent?.(group, identity.species, identity.gender, next, ageFractionFor(group));
    persistProfilesSoon();
    return next;
  }

  function consumeBodyInput(event) {
    if (document.body.dataset.animationAuthorMode !== MODE) return;
    const spec = BODY_FIELDS[event.target?.id];
    if (!spec) return;
    event.stopPropagation();
    event.stopImmediatePropagation(); // Blocks the legacy all-four-fields target listener from touching Head.

    const raw = Number(event.target.value);
    if (!Number.isFinite(raw)) return; // Keep partial/empty mobile number edits editable.
    if (spec.number && (raw < spec.min || raw > spec.max)) return; // Do not snap the first digit of a multi-digit typed value.
    const percent = clamp(raw, spec.min, spec.max);
    const pair = document.getElementById(spec.pair); // Mirrors the valid value into the range/number partner.
    if (pair) pair.value = String(percent);
    applyBodyField(spec.field, percent);
  }

  function commitBodyNumber(event) {
    if (document.body.dataset.animationAuthorMode !== MODE) return;
    const spec = BODY_FIELDS[event.target?.id];
    if (!spec?.number) return;
    event.stopPropagation();
    event.stopImmediatePropagation();
    const identity = selectedIdentity();
    const scale = currentScale(identity);
    const fallbackPercent = spec.field === 'offsetY' ? scale.offsetY * 100 : scale[spec.field] * 100;
    const typed = Number(event.target.value);
    const percent = Number.isFinite(typed) ? clamp(typed, spec.min, spec.max) : fallbackPercent;
    event.target.value = String(Math.round(percent * 10) / 10);
    const pair = document.getElementById(spec.pair);
    if (pair) pair.value = String(percent);
    applyBodyField(spec.field, percent);
  }

  function install() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || installedPanel === panel) return !!panel;
    installedPanel = panel;
    panel.addEventListener('input', consumeBodyInput, true);
    panel.addEventListener('change', commitBodyNumber, true);
    panel.addEventListener('focusout', event => {
      if (BODY_FIELDS[event.target?.id]?.number) commitBodyNumber(event);
    }, true);
    return true;
  }

  window.HobunjiFullScaleBodyInputGuard = Object.freeze({ nextScalePreservingHead, applyBodyField });

  install();
  let attempts = 0; // Panel is lazy; retry until character-scale-comparison.js creates it.
  const timer = setInterval(() => {
    if (install() || ++attempts >= 600) clearInterval(timer);
  }, 50);
})();
