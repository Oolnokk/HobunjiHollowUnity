// Animation Author → Rig Coordinates: reusable belt-stow anchor and live preview.
// Called by a small bridge in the author's existing rig workflow; all fields export
// through the native species/gender attachment profile, not a separate editor save.
(function (global) {
  'use strict';
  if (global.AnimationAuthorBeltStow) return;

  const KEY = 'beltStow'; // The same profile anchor consumed by AdventuringTorchBelt in gameplay.
  const previews = new WeakMap(); // One visual per selected actor; old actors collect naturally.
  let latestStatus = { state:'waiting', species:null, preview:false, texture:false }; // Mobile-readable diagnostics for rig editing.

  function isCharacter(actor) { return actor?.source?.type === 'npc'; }
  function heightOf(actor) {
    const value = Number(actor?.model?.userData?.portraitModelHeight);
    return Number.isFinite(value) && value > 0 ? value : .9; // Align initial stow position with this species' model height.
  }
  function ensureProfile(profile, actor) {
    if (!profile || !isCharacter(actor)) return profile;
    const math = global.HobunjiBeltStowRig;
    if (!math) return profile;
    profile.anchors ||= {};
    if (!profile.anchors[KEY]) profile.anchors[KEY] = math.defaultSnapshot(heightOf(actor));
    else profile.anchors[KEY] = math.normalizedSnapshot(profile.anchors[KEY], heightOf(actor));
    return profile;
  }
  function preserveNormalized(output, source) {
    for (const [key, profile] of Object.entries(output?.characters || {})) {
      const authored = source?.characters?.[key]?.anchors?.[KEY];
      if (authored) {
        profile.anchors ||= {};
        profile.anchors[KEY] = global.HobunjiBeltStowRig.normalizedSnapshot(authored);
      }
    }
    return output;
  }
  function anchorNames(names, actor) {
    if (!isCharacter(actor) || names.includes(KEY)) return names;
    return [...names, KEY]; // Reuses the editor's native move/rotate gizmo, fields and reset workflow.
  }
  function ensureActorAnchor(actor, THREE) {
    if (!isCharacter(actor) || !actor.visualOffset || !THREE?.Group) return null;
    if (actor.rigAnchors?.[KEY]) return actor.rigAnchors[KEY];
    actor.rigAnchors ||= {};
    const anchor = new THREE.Group();
    anchor.name = 'RigAnchor_beltStow_' + String(actor.id || '').replace(/[^a-z0-9_-]/gi, '_');
    const helper = THREE.AxesHelper ? new THREE.AxesHelper(.22) : null;
    if (helper) {
      helper.name = 'RigAnchorAxes_beltStow';
      helper.visible = false;
      anchor.add(helper);
    }
    actor.visualOffset.add(anchor);
    actor.rigAnchors[KEY] = anchor;
    return anchor;
  }

  function resetProfile(profile, actor) {
    if (!isCharacter(actor) || !profile) return false;
    profile.anchors ||= {};
    profile.anchors[KEY] = global.HobunjiBeltStowRig.defaultSnapshot(heightOf(actor));
    return true;
  }

  function previewFor(actor, THREE, textureUrl) {
    if (!isCharacter(actor) || !THREE) return null;
    const anchor = ensureActorAnchor(actor, THREE);
    if (!anchor) return null;
    let record = previews.get(actor);
    if (!record) {
      const display = global.HobunjiBeltStowRig?.createTorchDisplay?.(THREE);
      if (!display) return null;
      display.root.name = 'RigPreview_BeltStowedTorch';
      display.root.userData.nonInteractive = true;
      anchor.add(display.root);
      record = { display, assetUrl:null, loading:false, failed:false };
      previews.set(actor, record);
      actor.beltStowPreviewEnabled = actor.beltStowPreviewEnabled !== false;
      actor.beltStowPreviewLit = actor.beltStowPreviewLit !== false;
    }
    if (record.display.root.parent !== anchor) anchor.add(record.display.root);
    // A different repository/commit selection should load its own authentic torch texture.
    if (textureUrl && record.assetUrl !== textureUrl && !record.loading) {
      record.assetUrl = textureUrl;
      record.loading = true; record.failed = false;
      const requestedUrl = textureUrl; // Stale async images from a switched repository cannot override the new sprite.
      new THREE.TextureLoader().load(textureUrl, map => {
        if (record.assetUrl !== requestedUrl) { map.dispose?.(); return; }
        global.HobunjiSpritePngSurface?.configureTexture?.(THREE, map, requestedUrl);
        record.display.setTexture(map);
        record.loading = false;
      }, undefined, error => {
        if (record.assetUrl !== requestedUrl) return;
        record.failed = true; record.loading = false;
        global.__farmLog?.('[belt rig preview] Torch PNG failed: ' + String(error), 'warn');
      });
    }
    return record;
  }

  function syncPreview(actor, { mode, THREE, textureUrl } = {}) {
    if (!isCharacter(actor)) return null;
    const record = previewFor(actor, THREE, textureUrl);
    if (!record) return null;
    const visible = mode === 'rig' && actor.beltStowPreviewEnabled !== false;
    record.display.root.visible = visible; // Preview art is never a save/exported actor.
    record.display.setBurning(visible && actor.beltStowPreviewLit !== false,
      typeof performance !== 'undefined' ? performance.now() : 0);
    latestStatus = {
      state:record.failed?'texture-error':record.loading?'loading':record.display.art.material?.map?'ready':'no-texture',
      species:String(actor.source.species || '') + '::' + String(actor.source.gender || ''),
      preview:visible, flame:!!record.display.flame?.visible,
      texture:!!record.display.art.material?.map?.image,
      position:actor.rigAnchors?.[KEY]?.position ? {
        x:actor.rigAnchors[KEY].position.x, y:actor.rigAnchors[KEY].position.y, z:actor.rigAnchors[KEY].position.z,
      } : null,
    };
    return record;
  }

  function mountInspector({ actor, THREE, textureUrl, selectAnchor, applyChange, reset, render } = {}) {
    if (!isCharacter(actor) || typeof document === 'undefined') return;
    const inspector = document.getElementById('maaInspector');
    if (!inspector) return;
    const record = syncPreview(actor, { mode:'rig', THREE, textureUrl });
    const slot = document.createElement('section');
    slot.id = 'maaBeltStowSection';
    slot.className = 'maaSection';
    slot.innerHTML = `
      <div class="maaSectionTitle"><b>Belt-stowed equipment</b><span class="maaSmall maaMuted">Species + gender</span></div>
      <div class="maaSmall maaMuted">Edit the shared hip attachment point for belt-stowed tools. The torch is the first preview item. This position and rotation apply in gameplay while the tool is put away; they do not move held weapons.</div>
      <div class="maaRow" style="margin-top:8px">
        <button type="button" id="maaBeltStowEdit" class="secondary grow">Edit belt position / rotation</button>
        <button type="button" id="maaBeltStowReset" class="secondary">Reset</button>
      </div>
      <div class="maaField" style="margin-top:8px">
        <label for="maaBeltStowScale">Stowed item scale (×)</label>
        <input id="maaBeltStowScale" type="number" min="0.1" max="4" step="0.05" value="${Number(actor.rigAnchors?.[KEY]?.scale?.x || 1).toFixed(3)}">
      </div>
      <label class="maaToggleLine" style="margin-top:8px">
        <input type="checkbox" id="maaBeltStowPreview" style="width:auto;min-height:auto" ${actor.beltStowPreviewEnabled === false ? '' : 'checked'}> Show stowed torch on character
      </label>
      <label class="maaToggleLine" style="margin-top:6px">
        <input type="checkbox" id="maaBeltStowFlame" style="width:auto;min-height:auto" ${actor.beltStowPreviewLit === false ? '' : 'checked'}> Show lit flame in preview
      </label>
      <div class="maaRigStatus maaSmall" id="maaBeltStowStatus" style="margin-top:9px">
        Preview: ${record?.failed ? 'texture failed' : record?.loading ? 'loading PNG…' : record?.display.art.material?.map ? 'torch PNG ready' : 'waiting for sprite'}. Saved anchor: <b>anchors.beltStow</b>. Flame preview is visual only; gameplay extinguishes after 30 real seconds whether held or stowed.
      </div>`;
    inspector.appendChild(slot);
    slot.querySelector('#maaBeltStowEdit')?.addEventListener('click', () => selectAnchor?.());
    slot.querySelector('#maaBeltStowReset')?.addEventListener('click', () => { reset?.(); render?.(); });
    slot.querySelector('#maaBeltStowScale')?.addEventListener('change', event => {
      const scale = Number(event.currentTarget.value);
      const anchor = actor.rigAnchors?.[KEY];
      if (!anchor) return;
      if (!Number.isFinite(scale) || scale < .1 || scale > 4) {
        event.currentTarget.value = Number(anchor.scale.x).toFixed(3); return;
      }
      anchor.scale.set(scale, scale, scale); // One uniform stow scale; no axis-squashing of the torch artwork.
      applyChange?.('belt-stow item size', KEY);
    });
    slot.querySelector('#maaBeltStowPreview')?.addEventListener('change', event => {
      actor.beltStowPreviewEnabled = !!event.currentTarget.checked;
      syncPreview(actor, { mode:'rig', THREE, textureUrl });
    });
    slot.querySelector('#maaBeltStowFlame')?.addEventListener('change', event => {
      actor.beltStowPreviewLit = !!event.currentTarget.checked;
      syncPreview(actor, { mode:'rig', THREE, textureUrl });
    });
  }

  global.AnimationAuthorBeltStow = Object.freeze({
    KEY, ensureProfile, preserveNormalized, anchorNames, ensureActorAnchor,
    resetProfile, syncPreview, mountInspector,
    get debug() { return latestStatus; }, // Accessible on mobile without DevTools.
  });
})(window);
