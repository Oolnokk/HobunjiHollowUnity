// Attack Editor controls for the hand-only shoulder compass plus a preview-only
// switch that renders the base portrait without armL/armR. Axis choices are part
// of the reusable hand model profile; hiding the arms is intentionally not saved.
(function (global) {
  'use strict';

  const profiles = global.HobunjiHandModelProfiles;
  const profileSelect = document.getElementById('handProfileSelect');
  if (!profiles || !profileSelect || global.HobunjiAttackEditorHandShoulderControls) return;

  let hideArmSprites = false;

  function resolvedFighter(profile) {
    const fighter = profile?.fighter || null;
    if (!fighter) return null;
    const fighters = global.getPortraitFighters?.() || [];
    return fighters.find(candidate => candidate?.id === fighter.id)
      || (fighter.headUrl ? fighters.find(candidate => candidate?.headUrl === fighter.headUrl) : null)
      || fighter;
  }

  function noArmPreviewProfile(profile) {
    if (!hideArmSprites || !profile?.fighter) return profile;
    const sourceFighter = resolvedFighter(profile);
    if (!sourceFighter) return profile;
    const bodyLayers = (sourceFighter.bodyLayers || []).filter(layer => !/arm[lr]/i.test(String(layer?.id || '')));
    const headUrl = sourceFighter.headUrl
      ? `${sourceFighter.headUrl}${String(sourceFighter.headUrl).includes('?') ? '&' : '?'}hobunjiHideArms=1`
      : sourceFighter.headUrl;
    // The private id/head query prevents portrait-utils' resolver from swapping this
    // clone straight back to the catalog fighter (which would restore its arms).
    const fighter = {
      ...sourceFighter,
      id: `__hobunji_no_arm_preview__${sourceFighter.id || 'fighter'}`,
      originalId: sourceFighter.id,
      headUrl,
      bodyLayers,
    };
    return {
      ...profile,
      fighter,
      // Shoulder scanning still reads the real arm sprites even while they are hidden.
      __hobunjiShoulderSourceFighter: sourceFighter,
    };
  }

  // Wrap both aliases because some editor paths call renderProfile directly while
  // NpcAvatarPreview calls renderPortraitProfile. Both aliases currently point to
  // the same shoulder-scan wrapper, so guard against wrapping it twice.
  const renderWrapperMap = new Map();
  function wrapRender(original) {
    if (typeof original !== 'function') return original;
    if (renderWrapperMap.has(original)) return renderWrapperMap.get(original);
    const wrapped = function attackEditorHideArmRender(canvas, profile, renderOptions = {}) {
      if (canvas) canvas.__hobunjiHideArmSpritesPreview = hideArmSprites;
      return original.call(this, canvas, noArmPreviewProfile(profile), renderOptions);
    };
    wrapped.__hobunjiAttackEditorArmHideWrapped = true;
    renderWrapperMap.set(original, wrapped);
    return wrapped;
  }
  global.renderPortraitProfile = wrapRender(global.renderPortraitProfile);
  global.renderProfile = wrapRender(global.renderProfile);

  // portrait-arm-cloud-mask wraps NpcAvatarPreview before this script loads. Make
  // this the outermost adapter so hidden-arm previews cannot receive an arm-shaped
  // alpha cutout after the filtered portrait has already rendered.
  const previewApi = global.NpcAvatarPreview;
  if (previewApi?.renderProfileToCanvas && !previewApi.renderProfileToCanvas.__hobunjiAttackEditorArmHideWrapped) {
    const originalPreviewRender = previewApi.renderProfileToCanvas.bind(previewApi);
    const wrappedPreviewRender = async function attackEditorArmHidePreview(canvas, profile, renderOptions = {}) {
      const result = await originalPreviewRender(canvas, profile, renderOptions);
      if (hideArmSprites && canvas) canvas.hobunjiArmCloudAlphaMap = null;
      return result;
    };
    wrappedPreviewRender.__hobunjiAttackEditorArmHideWrapped = true;
    previewApi.renderProfileToCanvas = wrappedPreviewRender;
  }

  const handCard = profileSelect.closest('.card');
  const group = document.createElement('div');
  group.className = 'poseGroup';
  group.innerHTML = `
    <div class="poseGroupHead"><span class="dot" style="background:#fb7185"></span>Shoulder compass</div>
    <div class="help" style="margin-bottom:7px">The hand's local <b>+Y / top</b> is treated as the wrist end. A full target orientation points that end back toward the scanned shoulder; each checked channel independently adopts its target angle.</div>
    <div class="field"><label class="fieldRow" style="cursor:pointer"><input id="handShoulderAimPitch" type="checkbox" style="width:auto;margin-right:6px">Pitch → shoulder</label></div>
    <div class="field"><label class="fieldRow" style="cursor:pointer"><input id="handShoulderAimYaw" type="checkbox" style="width:auto;margin-right:6px">Yaw → shoulder</label></div>
    <div class="field"><label class="fieldRow" style="cursor:pointer"><input id="handShoulderAimRoll" type="checkbox" style="width:auto;margin-right:6px">Roll → shoulder</label></div>
    <div class="field" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.10)"><label class="fieldRow" style="cursor:pointer"><input id="handHideArmSpritesPreview" type="checkbox" style="width:auto;margin-right:6px">Hide arm sprites in preview</label></div>
    <div class="help" id="handShoulderAimStatus">Roll defaults on; Pitch and Yaw default off. Arm hiding is preview-only.</div>
  `;
  const status = document.getElementById('handEffectiveStatus');
  if (status?.parentElement === handCard) handCard.insertBefore(group, status);
  else handCard.appendChild(group);

  const pitch = document.getElementById('handShoulderAimPitch');
  const yaw = document.getElementById('handShoulderAimYaw');
  const roll = document.getElementById('handShoulderAimRoll');
  const hide = document.getElementById('handHideArmSpritesPreview');
  const compassStatus = document.getElementById('handShoulderAimStatus');

  function currentModel() {
    return profiles.data?.models?.[profileSelect.value] || null;
  }

  function normalizedAim(model) {
    const raw = model?.shoulderAim || {};
    return { pitch: raw.pitch === true, yaw: raw.yaw === true, roll: raw.roll !== false };
  }

  function syncControls() {
    const aim = normalizedAim(currentModel());
    pitch.checked = aim.pitch;
    yaw.checked = aim.yaw;
    roll.checked = aim.roll;
    hide.checked = hideArmSprites;
    compassStatus.textContent = `Current model: ${profileSelect.value || 'none'} · shoulder aim ${[
      aim.pitch ? 'Pitch' : null,
      aim.yaw ? 'Yaw' : null,
      aim.roll ? 'Roll' : null,
    ].filter(Boolean).join(' + ') || 'off'} · arms ${hideArmSprites ? 'hidden in preview' : 'visible'}.`;
  }

  function setAxis(axis, value) {
    const key = profileSelect.value;
    profiles.mutate(data => {
      const model = data.models?.[key];
      if (!model) return;
      model.shoulderAim = {
        pitch: model.shoulderAim?.pitch === true,
        yaw: model.shoulderAim?.yaw === true,
        roll: model.shoulderAim?.roll !== false,
        [axis]: !!value,
      };
    });
    global.ProceduralHandFrameDriver?.syncNow?.();
    syncControls();
  }

  function requestPreviewRebuild() {
    const species = document.getElementById('avatarSpecies');
    if (species) {
      species.dispatchEvent(new Event('change', { bubbles: true }));
      species.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      global.ProceduralHandFrameDriver?.syncNow?.();
    }
  }

  pitch.addEventListener('change', () => setAxis('pitch', pitch.checked));
  yaw.addEventListener('change', () => setAxis('yaw', yaw.checked));
  roll.addEventListener('change', () => setAxis('roll', roll.checked));
  hide.addEventListener('change', () => {
    hideArmSprites = hide.checked;
    syncControls();
    requestPreviewRebuild();
  });
  profileSelect.addEventListener('change', () => queueMicrotask(syncControls));

  syncControls();

  global.HobunjiAttackEditorHandShoulderControls = {
    get hideArmSprites() { return hideArmSprites; },
    setHideArmSprites(value) {
      hideArmSprites = !!value;
      syncControls();
      requestPreviewRebuild();
    },
    syncControls,
  };
})(window);
