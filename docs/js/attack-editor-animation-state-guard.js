// Attack Animation Editor state-order guards.
// Loaded before the editor's module script so it can make later core handlers
// deterministic without duplicating the editor's animation state.
(function (global) {
  'use strict';

  if (!/\/tools\/attack-animation-editor\//.test(location.pathname)) return;
  if (global.HobunjiAttackEditorAnimationStateGuard) return;

  const $ = id => document.getElementById(id);
  const flipButton = $('flipBtn');
  const resetButton = $('resetPosesBtn');
  const presetButton = $('loadPresetBtn');
  const loadFile = $('loadFile');
  const speciesSelect = $('avatarSpecies');
  const genderSelect = $('avatarGender');
  if (!flipButton || !resetButton || !presetButton || !loadFile) return;

  let mirrored = false; // Tracks the core editor's private toolMirrored flag from every user/programmatic Flip click.
  let mirrorNormalizations = 0; // Used by the visible status to expose order-dependent state repairs on mobile.
  let staleAvatarDiscards = 0; // Used by the visible status to expose prevented async species/gender races on mobile.
  let reorderedToolLoads = 0; // Used by the visible status to expose tool texture completions that arrived out of request order.
  let toolTextureGeneration = 0; // Assigns request order to editor tool textures before module-private setToolSprite() awaits them.
  let nextToolTextureDelivery = 1; // Identifies the oldest tool texture callback that may safely resume setToolSprite().
  const toolTextureCompletions = new Map(); // Buffers finished tool textures until all older requests have delivered first.
  let lastReason = 'ready'; // Used by the visible status to summarize the most recent automatic state repair.

  const status = document.createElement('div');
  status.id = 'animationStateGuardStatus';
  status.className = 'help';
  status.style.cssText = 'padding:7px;border:1px solid rgba(52,211,153,.25);border-radius:8px;margin:6px 0;white-space:normal';
  const debug = $('debug');
  if (debug?.parentElement) debug.parentElement.insertBefore(status, debug);

  function renderStatus() {
    status.textContent = `Animation state guard · mirror ${mirrored ? 'ON' : 'off'} · normalized ${mirrorNormalizations} · stale avatar rebuilds blocked ${staleAvatarDiscards} · reordered tool loads ${reorderedToolLoads} · ${lastReason}`;
  }

  // This capture listener runs before the core button's onclick handler. It mirrors
  // the exact boolean transition while leaving the core implementation authoritative.
  flipButton.addEventListener('click', () => {
    mirrored = !mirrored;
    lastReason = mirrored ? 'manual mirror enabled' : 'mirror cleared';
    renderStatus();
  }, true);

  function normalizeMirror(reason) {
    if (!mirrored) return false;
    // Use the real core Flip path instead of attempting to reach its module-private
    // toolBase/toolMirrored variables. The nested click clears poses/base/sprite together.
    flipButton.click();
    mirrorNormalizations += 1;
    lastReason = `cleared mirror before ${reason}`;
    renderStatus();
    return true;
  }

  // Reset, preset load, and JSON import all replace pose numbers with canonical,
  // unmirrored data. Clear the independent editor mirror first so action order can
  // never leave the tool base/sprite mirrored while the numeric poses are not.
  resetButton.addEventListener('click', () => normalizeMirror('pose reset'), true);
  presetButton.addEventListener('click', () => normalizeMirror('preset load'), true);
  loadFile.addEventListener('change', () => normalizeMirror('JSON import'), true);

  function normalizeIdentity(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function selectedIdentity() {
    return {
      speciesId: normalizeIdentity(speciesSelect?.value),
      gender: String(genderSelect?.value || 'male').trim().toLowerCase(),
    };
  }

  function profileIdentity(profile) {
    const source = profile?.appearance || profile?.fighter || profile || {};
    return {
      speciesId: normalizeIdentity(source.speciesId || source.species),
      gender: String(source.gender || 'male').trim().toLowerCase(),
    };
  }

  function profileIsStale(profile) {
    const selected = selectedIdentity();
    const requested = profileIdentity(profile);
    if (requested.speciesId && selected.speciesId && requested.speciesId !== selected.speciesId) return true;
    if (requested.gender && selected.gender && requested.gender !== selected.gender) return true;
    return false;
  }

  // rebuildAvatar() awaits several asynchronous portrait renders. Previously an
  // older species/gender request could finish after a newer one and replace the
  // preview with stale data. Guard each async render at both ends; throwing aborts
  // that stale rebuild before it can construct/install an avatar model.
  const preview = global.NpcAvatarPreview;
  if (preview?.renderProfileToCanvas && !preview.renderProfileToCanvas.__hobunjiStateOrderGuard) {
    const originalRender = preview.renderProfileToCanvas.bind(preview);
    const wrappedRender = async function guardedAvatarRender(canvas, profile, options = {}) {
      if (profileIsStale(profile)) {
        staleAvatarDiscards += 1;
        lastReason = 'blocked stale avatar rebuild before render';
        renderStatus();
        const error = new Error('stale avatar rebuild superseded by current species/gender');
        error.code = 'HOBUNJI_STALE_AVATAR_REBUILD';
        throw error;
      }
      const result = await originalRender(canvas, profile, options);
      if (profileIsStale(profile)) {
        staleAvatarDiscards += 1;
        lastReason = 'blocked stale avatar rebuild after render';
        renderStatus();
        const error = new Error('stale avatar rebuild superseded while portrait was rendering');
        error.code = 'HOBUNJI_STALE_AVATAR_REBUILD';
        throw error;
      }
      return result;
    };
    wrappedRender.__hobunjiStateOrderGuard = true;
    preview.renderProfileToCanvas = wrappedRender;
  }

  function isEditorToolSpriteUrl(url) {
    const src = String(url || '');
    return /\/assets\/toolsprites\//.test(src) || /\/assets\/objectsprites\/bottle_wine\.png(?:[?#].*)?$/.test(src);
  }

  function flushToolTextureCompletions() {
    while (toolTextureCompletions.has(nextToolTextureDelivery)) {
      const completion = toolTextureCompletions.get(nextToolTextureDelivery);
      toolTextureCompletions.delete(nextToolTextureDelivery);
      nextToolTextureDelivery += 1;
      if (completion.ok) completion.onLoad?.(completion.texture);
      else completion.onError?.(completion.error);
    }
  }

  // setToolSprite() is module-private and awaits TextureLoader completion. If an
  // older texture finishes after a newer request, the old await used to resume last
  // and replace the current tool. Deliver tool callbacks in request order instead:
  // when an old load is slow, all already-finished newer callbacks flush immediately
  // after it, so the newest requested tool is always the final installed sprite.
  const textureLoaderProto = global.THREE?.TextureLoader?.prototype;
  if (textureLoaderProto?.load && !textureLoaderProto.load.__hobunjiToolOrderGuard) {
    const originalTextureLoad = textureLoaderProto.load;
    const wrappedTextureLoad = function guardedTextureLoad(url, onLoad, onProgress, onError) {
      if (!isEditorToolSpriteUrl(url)) return originalTextureLoad.call(this, url, onLoad, onProgress, onError);
      const requestId = ++toolTextureGeneration; // Used below to serialize only editor held-tool texture callbacks.
      return originalTextureLoad.call(this, url, texture => {
        if (requestId !== nextToolTextureDelivery) {
          reorderedToolLoads += 1;
          lastReason = 'serialized out-of-order tool texture completion';
          renderStatus();
        }
        toolTextureCompletions.set(requestId, { ok: true, texture, onLoad, onError });
        flushToolTextureCompletions();
      }, onProgress, error => {
        if (requestId !== nextToolTextureDelivery) {
          reorderedToolLoads += 1;
          lastReason = 'serialized out-of-order tool texture error';
          renderStatus();
        }
        toolTextureCompletions.set(requestId, { ok: false, error, onLoad, onError });
        flushToolTextureCompletions();
      });
    };
    wrappedTextureLoad.__hobunjiToolOrderGuard = true;
    textureLoaderProto.load = wrappedTextureLoad;
  }

  renderStatus();
  global.HobunjiAttackEditorAnimationStateGuard = Object.freeze({
    get mirrored() { return mirrored; },
    get staleAvatarDiscards() { return staleAvatarDiscards; },
    get reorderedToolLoads() { return reorderedToolLoads; },
    normalizeMirror,
    updateStatus: renderStatus,
  });
})(window);