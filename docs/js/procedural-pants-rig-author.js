// Procedural Animation Editor: integrated Pants Rig Author + live 3D garment preview.
(function () {
  'use strict';

  if (window.ProceduralPantsRigAuthor?.installed) return;

  const SELF_SCRIPT_SRC = document.currentScript?.src || ''; // Keeps dynamically loaded authoring pieces on this exact branch/commit.
  const PANEL_ID = 'proceduralPantsRigPanel'; // Identifies the Pants workspace hosted by Procedural Animation.
  const BUTTON_ID = 'proceduralPantsRigQuickBtn'; // Identifies the visible Animation HUD entry button.
  const CORE_SCRIPT_ID = 'proceduralPantsRigCoreScript'; // Prevents duplicate shared pants-math loads.
  const DEFAULT_GARMENT_ID = 'pants_basic'; // Matches the repository garment uploaded by the user.
  const DEFAULT_IMAGE_PATH = 'assets/cosmetics/clothes/legs/pants_basic.png'; // Runtime-relative path stored with the authored garment.
  const DEFAULT_IMAGE_URL = SELF_SCRIPT_SRC
    ? new URL('../assets/cosmetics/clothes/legs/pants_basic.png', SELF_SCRIPT_SRC).href
    : new URL('../../assets/cosmetics/clothes/legs/pants_basic.png', window.location.href).href; // Supplies the clean PNG to the live preview.
  const AUTHOR_URL = SELF_SCRIPT_SRC
    ? new URL('../tools/pants-rig-author/index.html?embedded=1', SELF_SCRIPT_SRC).href
    : new URL('../pants-rig-author/index.html?embedded=1', window.location.href).href; // Hosts the existing 2D author inside Procedural Animation.

  const state = { // Owns the editor-only Pants UI and preview resources.
    panel: null,
    iframe: null,
    quickButton: null,
    liveToggle: null,
    status: null,
    open: false,
    coreReady: false,
    preview: null,
    lastModel: null,
    lastIdentityKey: '',
    forceRebuild: true,
    frameCount: 0,
    buildGeneration: 0,
  };

  function normalizeSpecies(value) {
    return String(value || '').trim().toLowerCase().replace(/_/g, '-');
  }

  function normalizeGender(value) {
    return String(value || '').trim().toLowerCase();
  }

  function identityKey(identity) {
    return `${normalizeSpecies(identity?.speciesId)}::${normalizeGender(identity?.gender)}`;
  }

  function editorLog(message, level = 'info', extra = null) {
    const backdropLog = window.HobunjiGameplayBackdrop?.log; // Reuses the procedural tool's in-page diagnostics when available.
    if (backdropLog) { backdropLog(message, level, extra); return; }
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
    fn(`[Pants Rig] ${message}`, extra ?? '');
  }

  function setStatus(message, kind = 'good') {
    if (performance.now() < (window.ProceduralPantsRigStatusHoldUntil || 0)) return; // A just-finished button action's result stays readable.
    if (state.status) {
      state.status.textContent = message;
      state.status.dataset.kind = kind;
    }
    const pill = document.getElementById('statusPill'); // Mirrors important Pants state into the procedural editor's mobile-visible status pill.
    if (pill && state.open) {
      pill.textContent = message;
      pill.className = kind === 'warn' ? 'pill warn' : 'pill good';
    }
  }

  function loadCoreMath() {
    if (window.HobunjiPantsRig) {
      state.coreReady = true;
      return Promise.resolve(window.HobunjiPantsRig);
    }
    const existing = document.getElementById(CORE_SCRIPT_ID); // Shares an in-flight core load if this adapter is evaluated twice.
    if (existing) {
      return new Promise((resolve, reject) => {
        existing.addEventListener('load', () => {
          state.coreReady = !!window.HobunjiPantsRig;
          state.coreReady ? resolve(window.HobunjiPantsRig) : reject(new Error('Pants rig core did not install.'));
        }, { once: true });
        existing.addEventListener('error', reject, { once: true });
      });
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script'); // Loads only shared rig math; all preview rendering stays on the procedural editor's native Three objects.
      script.id = CORE_SCRIPT_ID;
      script.async = false;
      script.src = SELF_SCRIPT_SRC
        ? new URL('pants-rig-core.js', SELF_SCRIPT_SRC).href
        : new URL('../../js/pants-rig-core.js', window.location.href).href;
      script.addEventListener('load', () => {
        state.coreReady = !!window.HobunjiPantsRig;
        state.coreReady ? resolve(window.HobunjiPantsRig) : reject(new Error('pants-rig-core loaded without installing HobunjiPantsRig.'));
      }, { once: true });
      script.addEventListener('error', () => reject(new Error(`Failed to load ${script.src}`)), { once: true });
      document.head.appendChild(script);
    });
  }

  // The live preview is drawn by the same module the game uses (js/pants-garment-renderer.js).
  function loadRenderer() {
    if (window.PantsGarmentRenderer) return Promise.resolve(window.PantsGarmentRenderer);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.id = 'proceduralPantsGarmentRendererScript';
      script.async = false;
      script.src = SELF_SCRIPT_SRC
        ? new URL('pants-garment-renderer.js', SELF_SCRIPT_SRC).href
        : new URL('../../js/pants-garment-renderer.js', window.location.href).href;
      script.addEventListener('load', () => window.PantsGarmentRenderer ? resolve(window.PantsGarmentRenderer) : reject(new Error('pants-garment-renderer loaded without installing PantsGarmentRenderer.')), { once: true });
      script.addEventListener('error', () => reject(new Error(`Failed to load ${script.src}`)), { once: true });
      document.head.appendChild(script);
    });
  }

  function loadCore() {
    return loadCoreMath().then(core => loadRenderer().then(() => core));
  }

  function authorApi() {
    try { return state.iframe?.contentWindow?.__pantsRigAuthorDebug || null; }
    catch (_) { return null; }
  }

  function selectedIdentity() {
    const backdrop = window.HobunjiGameplayBackdrop; // Reads the exact Procedural Animation preview selection.
    const selected = backdrop?.getSelectedNpc?.();
    const appearance = selected?.appearance || {};
    const speciesId = appearance.speciesId || selected?.speciesId || selected?.species || selected?.fighter?.speciesId;
    const gender = appearance.gender || selected?.gender || selected?.fighter?.gender;
    if (speciesId && gender) return { speciesId, gender };
    const fighter = authorApi()?.state?.()?.fighter; // Falls back to the embedded author's canonical portrait selection before an NPC is selected.
    return fighter ? { speciesId: fighter.speciesId || fighter.id, gender: fighter.gender } : null;
  }

  // The species' posterior (hip pivot) height as a portrait-canvas y, so an unauthored species starts with its beltline there.
  function posteriorPortraitYForModel(model) {
    const THREE = window.HobunjiGameplayBackdrop?.getThree?.();
    const Renderer = window.PantsGarmentRenderer;
    return THREE && Renderer?.posteriorPortraitYForAvatar ? Renderer.posteriorPortraitYForAvatar(THREE, model, legSearchRoot(model)) : null;
  }

  function syncAuthorToProceduralIdentity(model = null) {
    const identity = selectedIdentity(); // Keeps portrait-belt authoring on the same species/gender as the live 3D avatar.
    if (!identity) return null;
    const avatar = model || window.HobunjiGameplayBackdrop?.getAvatarModel?.() || null;
    authorApi()?.setCharacter?.(identity.speciesId, identity.gender, avatar ? posteriorPortraitYForModel(avatar) : null);
    return identity;
  }

  function currentAuthorProject() {
    const api = authorApi(); // Reads the dense/current editor state through its existing export boundary rather than duplicating weight serialization.
    if (!api?.exportProject) return null;
    try { return api.exportProject(); }
    catch (error) {
      editorLog('Could not read the embedded pants project.', 'warn', error);
      return null;
    }
  }

  function currentGarmentId() {
    return String(authorApi()?.state?.()?.garmentId || DEFAULT_GARMENT_ID);
  }

  function legSearchRoot(model) {
    let root = model; // The editor keeps its solved leg chain on the floor-anchored locomotion root, a sibling branch of the avatar model rather than a child of it.
    while (root?.parent && root.parent.type !== 'Scene') root = root.parent;
    return root;
  }

  function portraitsFlipped() {
    return window.PNGPlaneAvatar?.getPortraitsFlipped?.() === true; // The game mirrors every portrait texture by default (UV repeat.x = -1); garment geometry must mirror with it.
  }

  function findLegNodes(model) {
    const root = legSearchRoot(model);
    if (!root?.getObjectByName) return null;
    const flipped = portraitsFlipped(); // Mirrored art puts the garment's image-left leg on the screen-right side, which is where the right_* IK nodes live.
    const nodes = { // These are the procedural editor's existing IK transforms, not a Pants-specific skeleton.
      leftThigh: root.getObjectByName(flipped ? 'right_thigh' : 'left_thigh'),
      leftCalf: root.getObjectByName(flipped ? 'right_calf' : 'left_calf'),
      rightThigh: root.getObjectByName(flipped ? 'left_thigh' : 'right_thigh'),
      rightCalf: root.getObjectByName(flipped ? 'left_calf' : 'right_calf'),
    };
    return Object.values(nodes).every(Boolean) ? nodes : null;
  }

  function garmentSourceUrl(garment) {
    const path = String(garment?.image || DEFAULT_IMAGE_PATH).trim() || DEFAULT_IMAGE_PATH;
    if (/^https?:/i.test(path)) return path;
    if (path.startsWith('assets/')) return SELF_SCRIPT_SRC
      ? new URL(`../${path}`, SELF_SCRIPT_SRC).href
      : new URL(`../../${path}`, window.location.href).href;
    return DEFAULT_IMAGE_URL;
  }

  function disposePreview() {
    state.buildGeneration++; // Invalidates any in-flight async rebuild so it cannot re-attach a mesh after this disposal.
    state.preview?.handle?.dispose?.();
    state.preview = null;
  }

  // The live preview IS the in-game garment: js/pants-garment-renderer.js builds and skins the mesh (weights, 3D bone
  // alignment, belt scale, leg roll, foot lift) from the author's live, unsaved records, so what you see here is what
  // the game draws.
  async function rebuildPreview(model, project, identity) {
    const Core = window.HobunjiPantsRig;
    const Renderer = window.PantsGarmentRenderer;
    const THREE = window.HobunjiGameplayBackdrop?.getThree?.(); // The editor keeps three as a module import, so it hands the namespace over explicitly.
    if (!Core || !model || !project || !identity) return false;
    const garmentId = currentGarmentId();
    const garment = project.garments?.[garmentId] || project.garments?.[DEFAULT_GARMENT_ID] || Object.values(project.garments || {})[0];
    const character = project.characters?.[identityKey(identity)];
    const nodes = findLegNodes(model);
    if (!garment || !character || !nodes || !Renderer || !THREE) {
      const reason = !nodes ? 'procedural leg chain' : !character ? 'authored species beltline' : !(Renderer && THREE) ? 'native 3D constructors' : 'garment data';
      setStatus(`Pants 3D preview is waiting for ${reason}.`, 'warn');
      disposePreview();
      return false;
    }
    disposePreview();
    const handle = Renderer.attach(THREE, {
      avatarGroup: model, legHandle: { group: legSearchRoot(model) }, speciesId: identity.speciesId, gender: identity.gender,
      garmentId, garmentRecord: garment, characterRecord: character, imageUrl: garmentSourceUrl(garment), name: 'pantsLivePreview',
      footObjects: window.HobunjiGameplayBackdrop?.getFootObjects?.() || null,
    });
    if (!handle) {
      setStatus('Could not solve pants beltline mapping for this species.', 'warn');
      return false;
    }
    state.preview = { handle, model, nodes: handle.nodes, garmentId, identityKey: identityKey(identity) };
    setStatus('Live pants preview bound to this Procedural Animation avatar + its existing IK legs.', 'good');
    return true;
  }

  // Runs every rendered frame: the renderer re-aligns the garment's thigh/calf bones onto the live 3D legs and skins it.
  function updatePreviewPose() {
    const preview = state.preview;
    if (!preview || !preview.model?.parent) return;
    preview.handle.update();
  }

  async function syncPreviewBinding() {
    if (!state.open || !state.liveToggle?.checked) {
      disposePreview();
      return;
    }
    const backdrop = window.HobunjiGameplayBackdrop;
    if (backdrop?.getPreviewMode?.() === 'creature') {
      disposePreview();
      setStatus('Pants rig preview is for humanoid NPC/player portraits, not creature mode.', 'warn');
      return;
    }
    const model = backdrop?.getAvatarModel?.(); // Exact avatar currently driven by Procedural Animation.
    const identity = syncAuthorToProceduralIdentity(model);
    const identityChanged = identityKey(identity) !== state.lastIdentityKey; // Triggers a new species/gender static fit and belt mapping.
    const modelChanged = model !== state.lastModel; // Triggers rebinding when Procedural Animation swaps its preview avatar.
    if (!model || !identity) {
      setStatus('Waiting for a Procedural Animation avatar…', 'warn');
      return;
    }
    // Swapping NPCs while Pants is open rebuilds the procedural leg chain (and may keep the same model object), which
    // leaves the preview skinning against the previous NPC's now-detached leg nodes. Compare against the live chain.
    const liveNodes = findLegNodes(model);
    const nodesChanged = !!state.preview && (!liveNodes || Object.keys(liveNodes).some(key => liveNodes[key] !== state.preview.nodes[key]));
    if (!state.forceRebuild && !identityChanged && !modelChanged && !nodesChanged && state.preview) return;
    const project = currentAuthorProject(); // Export/weight encoding is only paid when an edit/avatar change actually requires a rebuild.
    if (!project) {
      setStatus('Waiting for the embedded Pants Rig Author…', 'warn');
      return;
    }
    state.forceRebuild = false;
    state.lastModel = model;
    state.lastIdentityKey = identityKey(identity);
    await rebuildPreview(model, project, identity);
  }

  function injectStyles() {
    if (document.getElementById('proceduralPantsRigStyles')) return;
    const style = document.createElement('style'); // Makes Pants behave like the existing Impact/Dance authoring workspaces.
    style.id = 'proceduralPantsRigStyles';
    style.textContent = `
#${PANEL_ID}{position:absolute;z-index:120;top:max(8px,env(safe-area-inset-top));right:max(8px,env(safe-area-inset-right));bottom:max(8px,env(safe-area-inset-bottom));width:min(620px,52vw);max-width:calc(100% - 16px);display:none;flex-direction:column;min-height:0;overflow:hidden;border:1px solid rgba(255,255,255,.18);border-radius:15px;background:rgba(7,16,26,.985);box-shadow:0 22px 70px rgba(0,0,0,.62)}
#${PANEL_ID}.open{display:flex}
#${PANEL_ID} .pantsRigHostTools button{-webkit-tap-highlight-color:rgba(107,169,255,.45)}
@media(pointer:coarse){#${PANEL_ID} .pantsRigHostTools button{min-height:44px}}
#${PANEL_ID}.pantsRigExpanded{top:max(8px,env(safe-area-inset-top));left:max(8px,env(safe-area-inset-left));right:max(8px,env(safe-area-inset-right));bottom:max(8px,env(safe-area-inset-bottom));width:auto;max-width:none;height:auto;box-shadow:0 0 0 100vmax rgba(2,6,12,.62),0 22px 70px rgba(0,0,0,.7)}
#${PANEL_ID} .pantsRigHostHeader{flex:0 0 auto;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:7px 9px;border-bottom:1px solid rgba(255,255,255,.12);background:linear-gradient(180deg,rgba(22,37,56,.99),rgba(11,20,31,.99))}
#${PANEL_ID} .pantsRigHostTitle{font-size:12px;font-weight:800;color:#dce9ff}.pantsRigHostSub{font-size:10px;color:#9eb2cb;margin-top:2px}
#${PANEL_ID} .pantsRigHostTools{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}
#${PANEL_ID} .pantsRigHostTools label{display:flex;align-items:center;gap:5px;font-size:10px;color:#c7d5e8;white-space:nowrap}
#${PANEL_ID} .pantsRigHostTools input{width:auto}
#${PANEL_ID} .pantsRigHostTools button{min-height:34px;padding:5px 8px}
#${PANEL_ID} .pantsRigHostBody{flex:1 1 0;min-height:0;display:flex;flex-direction:column;overflow:hidden}
#${PANEL_ID} iframe{display:block;flex:1 1 0;min-height:0;width:100%;border:0;background:#07101a}
#${PANEL_ID} .pantsRigHostStatus{flex:0 0 auto;max-height:4.5em;overflow:auto;white-space:pre-wrap;padding:5px 8px;border-top:1px solid rgba(255,255,255,.1);font:10px/1.35 ui-monospace,monospace;color:#9edfbf;background:#07101a}.pantsRigHostStatus[data-kind="warn"]{color:#ffc857}
@media(max-width:700px) and (orientation:portrait){#${PANEL_ID}{top:auto;left:max(4px,env(safe-area-inset-left));right:max(4px,env(safe-area-inset-right));bottom:max(4px,env(safe-area-inset-bottom));width:auto;height:min(58dvh,690px);max-width:none;border-radius:13px}#${PANEL_ID} .pantsRigHostHeader{padding:5px 7px}.pantsRigHostSub{display:none}}
@media(max-height:520px) and (orientation:landscape){#${PANEL_ID}{top:max(4px,env(safe-area-inset-top));right:max(4px,env(safe-area-inset-right));bottom:max(4px,env(safe-area-inset-bottom));width:min(560px,48vw);border-radius:11px}}
`;
    document.head.appendChild(style);
  }

  function avoidFootingHud() {
    const panel = state.panel;
    if (!panel) return;
    panel.style.removeProperty('top'); // Restores the stylesheet position before measuring.
    if (panel.classList.contains('pantsRigExpanded')) return; // The enlarged floating window is layered above the Footing HUD, so it needs no avoidance.
    if (window.matchMedia?.('(max-width:700px) and (orientation:portrait)').matches) return; // Portrait phones anchor the panel to the bottom instead.
    const hud = document.getElementById('footingHud'); // Sits on a higher layer than the modal root and would cover the host header (Live 3D / Apply to NPC).
    const bottom = hud?.getBoundingClientRect?.().bottom || 0;
    if (bottom > 0) panel.style.top = `${Math.ceil(bottom) + 6}px`;
  }

  const EXPANDED_Z_INDEX = '200'; // Above the Footing HUD (24), loading overlay (35), NPC drawer (70), debug panel (90) and the placement/foot docks (180/181).
  function setExpanded(expanded, title = '') { // Floating window above everything while exactly one author workspace is enlarged.
    const panel = state.panel;
    if (!panel) return;
    const root = panel.parentElement; // #gameModalOverlayRoot: its z-index (20) sits under the HUD, so lift the whole layer.
    const sub = panel.querySelector('.pantsRigHostSub');
    if (expanded) {
      if (root && root.dataset.pantsPreviousZ == null) root.dataset.pantsPreviousZ = root.style.zIndex || '';
      if (root) root.style.zIndex = EXPANDED_Z_INDEX;
      if (sub) { if (sub.dataset.pantsPreviousText == null) sub.dataset.pantsPreviousText = sub.textContent; sub.textContent = title ? `Enlarged · ${title}` : 'Enlarged workspace'; }
    } else {
      if (root && root.dataset.pantsPreviousZ != null) { root.style.zIndex = root.dataset.pantsPreviousZ; delete root.dataset.pantsPreviousZ; }
      if (sub && sub.dataset.pantsPreviousText != null) { sub.textContent = sub.dataset.pantsPreviousText; delete sub.dataset.pantsPreviousText; }
    }
    panel.classList.toggle('pantsRigExpanded', !!expanded);
    if (state.open) avoidFootingHud();
  }

  function setOpen(open) {
    state.open = !!open;
    state.panel?.classList.toggle('open', state.open);
    state.quickButton?.classList.toggle('active', state.open);
    if (state.open) {
      avoidFootingHud();
      state.forceRebuild = true;
      syncAuthorToProceduralIdentity();
      setStatus('Pants Rig open · Live 3D uses the exact Procedural Animation avatar/IK legs.', 'good');
    } else {
      setExpanded(false);
      try { state.iframe?.contentWindow?.postMessage({ type: 'hobunji-pants-rig-exit-enlarge' }, window.location.origin); } catch (_) {}
      state.buildGeneration++; // Invalidates any in-flight texture load before the panel disappears.
      disposePreview();
    }
  }

  function buildPanel() {
    const modalRoot = document.getElementById('gameModalOverlayRoot'); // Keeps Pants inside the Procedural Animation tool's existing full-viewport UI layer.
    const actionRow = document.querySelector('#animationHud .animationHudActions'); // Receives the new Pants workspace entry beside existing animation actions.
    if (!modalRoot || !actionRow || document.getElementById(PANEL_ID)) return false;
    injectStyles();

    const panel = document.createElement('section'); // Floating/docked authoring panel; on mobile it becomes a bottom sheet.
    panel.id = PANEL_ID;
    panel.setAttribute('aria-label', 'Pants Rig Author');
    panel.innerHTML = `
      <div class="pantsRigHostHeader"><!-- Deliberately a div: the editor stylesheet hides every header element with display:none !important. -->
        <div><div class="pantsRigHostTitle">👖 Pants Rig Author</div><div class="pantsRigHostSub">2D rig + visible weight paint + live deformation on this procedural avatar</div></div>
        <div class="pantsRigHostTools">
          <label><input id="proceduralPantsLive3d" type="checkbox" checked> Live 3D</label>
          <button id="proceduralPantsRebind" type="button" class="secondary">Rebind</button>
          <button id="proceduralPantsClose" type="button" class="secondary" aria-label="Close Pants Rig">×</button>
        </div>
      </div>
      <div class="pantsRigHostBody">
        <iframe id="proceduralPantsRigFrame" title="Pants Rig Author"></iframe>
        <div id="proceduralPantsRigStatus" class="pantsRigHostStatus">Loading pants author…</div>
      </div>`;
    modalRoot.appendChild(panel);
    state.panel = panel;
    state.iframe = panel.querySelector('#proceduralPantsRigFrame');
    state.liveToggle = panel.querySelector('#proceduralPantsLive3d');
    state.status = panel.querySelector('#proceduralPantsRigStatus');
    state.iframe.addEventListener('load', () => {
      state.forceRebuild = true;
      setTimeout(() => {
        syncAuthorToProceduralIdentity();
        authorApi()?.loadDefaultPants?.();
        authorApi()?.renderWeightOverlay?.();
      }, 0);
    });
    state.iframe.src = AUTHOR_URL;
    state.liveToggle.addEventListener('change', () => {
      state.forceRebuild = true;
      if (!state.liveToggle.checked) disposePreview();
    });
    panel.querySelector('#proceduralPantsRebind').addEventListener('click', event => {
      const button = event.currentTarget;
      button.classList.add('active'); // Immediate tap feedback.
      setTimeout(() => button.classList.remove('active'), 600);
      window.ProceduralPantsRigStatusHoldUntil = 0; // Rebind's own status should show right away.
      state.forceRebuild = true;
      syncAuthorToProceduralIdentity();
      setStatus('Rebinding pants preview to the current procedural avatar…', 'good');
    });
    panel.querySelector('#proceduralPantsClose').addEventListener('click', () => setOpen(false));

    const quick = document.createElement('button'); // Makes Pants a first-class Procedural Animation workspace instead of a separate tool-hub page.
    quick.id = BUTTON_ID;
    quick.type = 'button';
    quick.className = 'secondary';
    quick.textContent = 'Pants';
    quick.title = 'Open Pants Rig Author on the current Procedural Animation avatar';
    quick.addEventListener('click', () => setOpen(!state.open));
    actionRow.appendChild(quick);
    state.quickButton = quick;

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && state.open) setOpen(false);
    });
    window.addEventListener('resize', () => { if (state.open) avoidFootingHud(); });
    window.addEventListener('message', event => {
      if (event.source === state.iframe?.contentWindow && event.data?.type === 'hobunji-pants-rig-enlarge') { setExpanded(event.data.enlarged === true, String(event.data.title || '')); return; }
      if (event.source !== state.iframe?.contentWindow || event.data?.type !== 'hobunji-pants-rig-changed') return;
      state.forceRebuild = true; // Rebuilds geometry/weights after a completed 2D authoring gesture rather than serializing the project every animation frame.
    });
    const observer = new MutationObserver(() => {
      if (state.panel && !modalRoot.contains(state.panel)) modalRoot.appendChild(state.panel); // Restores the workspace if the procedural preview rebuilds its modal layer.
    });
    observer.observe(modalRoot, { childList: true });
    return true;
  }

  async function frame() {
    state.frameCount++;
    if (state.open && state.liveToggle?.checked) {
      updatePreviewPose(); // Reads the procedural IK transforms every rendered frame.
      if (state.forceRebuild || state.frameCount % 30 === 0) await syncPreviewBinding(); // Periodic check catches avatar swaps even if no authoring event fired.
    }
    requestAnimationFrame(() => { frame().catch(error => editorLog('Pants Rig frame error', 'warn', error)); });
  }

  async function init() {
    await loadCore();
    const install = () => {
      if (!buildPanel()) return false;
      editorLog('Integrated Pants Rig Author ready inside Procedural Animation.');
      window.dispatchEvent(new Event('hobunji-pants-rig-panel-ready')); // Lets host-header add-ons (Apply to NPC) attach whenever the panel exists, however late the editor built its HUD.
      requestAnimationFrame(() => { frame().catch(error => editorLog('Pants Rig loop failed', 'warn', error)); });
      return true;
    };
    if (!install()) {
      const started = performance.now(); // Bounds retries while the giant procedural editor finishes building its HUD/modal roots.
      const retry = () => {
        if (install()) return;
        if (performance.now() - started > 12000) {
          editorLog('Could not find the Procedural Animation HUD/modal root for Pants Rig.', 'warn');
          return;
        }
        requestAnimationFrame(retry);
      };
      requestAnimationFrame(retry);
    }
  }

  // How well the garment's 2D bones currently sit on the live 3D leg bones, per side, in avatar-local units. Every
  // *Error should be ~0 and kneeMidpointError3D is 0 for an unbent leg (the solver puts the knee at exactly half).
  const boneAlignmentReport = () => state.preview?.handle?.alignmentReport?.() || null;

  window.ProceduralPantsRigAuthor = {
    installed: true,
    getBoneAlignment: boneAlignmentReport,
    getPreviewData: () => (state.preview ? { base: state.preview.handle.basePositions, weights: state.preview.handle.weights, positions: state.preview.handle.geometry.getAttribute('position').array } : null),
    open: () => setOpen(true),
    close: () => setOpen(false),
    rebuild: () => { state.forceRebuild = true; },
    getPreviewMesh: () => state.preview?.handle?.mesh || null,
    getPreviewHandle: () => state.preview?.handle || null,
    getAuthorFrame: () => state.iframe || null,
    debugSnapshot: () => ({
      open: state.open,
      coreReady: state.coreReady,
      live3d: !!state.liveToggle?.checked,
      authorReady: !!authorApi(),
      garmentId: currentGarmentId(),
      identity: selectedIdentity(),
      modelName: window.HobunjiGameplayBackdrop?.getAvatarModel?.()?.name || null,
      previewBound: !!state.preview,
      previewVertices: state.preview?.handle?.geometry?.getAttribute?.('position')?.count || 0,
      proceduralLegs: !!findLegNodes(window.HobunjiGameplayBackdrop?.getAvatarModel?.()),
      globalThreeRequired: false,
    }),
  }; // Mobile-readable diagnostics without needing a console.

  init().catch(error => editorLog(`Pants Rig integration failed: ${error?.message || error}`, 'error', error));
})();
