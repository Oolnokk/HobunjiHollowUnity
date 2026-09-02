// Procedural Animation Editor: accessible Impact authoring workspace.
// Converts the nested baked-blendspace accordion into sibling tabs without
// recreating any controls, preserving all listeners installed by the editor.
(function () {
  'use strict';

  const STYLE_ID = 'proceduralImpactTabsStyles'; // Prevents duplicate workspace CSS if the adapter is evaluated twice.
  const LIMB_POSE_SCRIPT_ID = 'proceduralLimbPoseAuthorScript'; // Keeps the new Ground / Carry authoring adapter single-loaded beside this existing procedural-editor adapter.

  function loadLimbPoseAuthor() {
    if (window.HobunjiProceduralLimbPoseAuthor || document.getElementById(LIMB_POSE_SCRIPT_ID)) return;
    const script = document.createElement('script'); // Loads the isolated anatomy/ground/carry workspace without modifying the editor's 2 MB embedded HTML.
    script.id = LIMB_POSE_SCRIPT_ID;
    script.src = '../../js/procedural-limb-pose-author.js?v=20260902a';
    script.defer = true;
    script.onerror = () => console.error('[Impact tabs] Ground / Carry pose author failed to load.');
    document.head.appendChild(script);
  }

  function injectImpactWorkspaceStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); // Holds styles used only by the procedural editor's Impact modal.
    style.id = STYLE_ID;
    style.textContent = `
#gameModalOverlayRoot > #footingPanel:not([open]){display:none!important}
#gameModalOverlayRoot > #footingPanel[open]{position:absolute!important;top:max(8px,env(safe-area-inset-top))!important;right:max(8px,env(safe-area-inset-right))!important;bottom:max(8px,env(safe-area-inset-bottom))!important;left:auto!important;display:grid!important;grid-template-rows:auto minmax(0,1fr);width:min(520px,44vw)!important;max-width:calc(100% - 16px)!important;max-height:none!important;margin:0!important;overflow:hidden!important;border:1px solid rgba(255,255,255,.18)!important;border-radius:15px;background:rgba(7,16,26,.985)!important;box-shadow:0 22px 70px rgba(0,0,0,.62)}
#gameModalOverlayRoot > #footingPanel > summary{position:static;min-height:48px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,rgba(22,37,56,.99),rgba(11,20,31,.99))}
#gameModalOverlayRoot > #footingPanel > summary::before{content:"×";transform:none;font-size:19px}
#gameModalOverlayRoot > #footingPanel > .authoringBody{min-height:0;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.impactWorkspaceTabs{position:sticky;top:0;z-index:4;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;padding:8px;border-bottom:1px solid rgba(255,255,255,.12);background:rgba(7,16,26,.97)}
.impactWorkspaceTabs button[aria-selected="true"]{border-color:var(--accent);background:rgba(107,169,255,.28);outline:2px solid rgba(107,169,255,.45);outline-offset:-2px}
.impactTabPanel{padding:10px}.impactTabPanel[hidden]{display:none!important}
@media(max-width:700px) and (orientation:portrait){#gameModalOverlayRoot > #footingPanel[open]{top:auto!important;right:max(4px,env(safe-area-inset-right))!important;bottom:max(4px,env(safe-area-inset-bottom))!important;left:max(4px,env(safe-area-inset-left))!important;width:auto!important;height:min(46dvh,520px)!important;max-width:none!important;border-radius:13px}#gameModalOverlayRoot > #footingPanel > summary{padding:7px 9px}.impactWorkspaceTabs{padding:6px}.impactWorkspaceTabs button{min-height:38px;padding:6px;font-size:11px}.impactTabPanel{padding:7px}}
@media(max-height:520px) and (orientation:landscape){#gameModalOverlayRoot > #footingPanel[open]{top:max(4px,env(safe-area-inset-top))!important;right:max(4px,env(safe-area-inset-right))!important;bottom:max(4px,env(safe-area-inset-bottom))!important;width:min(480px,46vw)!important;border-radius:11px}}
`;
    document.head.appendChild(style);
  }

  function makeTab(id, label, tabName, panelId, selected) {
    const tab = document.createElement('button'); // Selects one of the two sibling Impact workspace panels.
    tab.id = id;
    tab.type = 'button';
    tab.className = 'secondary';
    tab.textContent = label;
    tab.dataset.impactTab = tabName;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panelId);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    return tab;
  }

  function selectImpactTab(panel, tabName, focus) {
    const selectedName = tabName === 'blendspace' ? 'blendspace' : 'authoring'; // Normalizes all callers to an existing tab.
    const tabs = panel.querySelectorAll('[data-impact-tab]'); // Keeps ARIA state and visible panels synchronized.
    tabs.forEach((tab) => {
      const selected = tab.dataset.impactTab === selectedName; // Determines which corresponding panel remains visible.
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const tabPanel = document.getElementById(tab.getAttribute('aria-controls')); // Resolves the panel owned by this tab button.
      if (tabPanel) tabPanel.hidden = !selected;
      if (selected && focus) tab.focus({ preventScroll: true });
    });
    const body = panel.querySelector('.authoringBody'); // Returns each newly selected view to the start of its shared scroller.
    if (body) body.scrollTop = 0;
  }

  function updateVisibleStatus(message) {
    const status = document.getElementById('statusPill'); // Reuses the editor's mobile-visible status readout for navigation feedback.
    if (!status) return;
    status.textContent = message;
    status.className = 'pill good';
  }

  function creaturePngPlaneDimensions(model) {
    let plane = null; // Captures either rendered animal face; both share one canonical PNG-plane geometry size.
    model?.traverse?.((node) => {
      if (!plane && node.isMesh && (node.userData?.hobunjiPlaneFace || /_front_plane$/.test(node.name || ''))) plane = node;
    });
    const parameters = plane?.geometry?.parameters || {}; // PlaneGeometry retains authored width/height after the optional animal head-rig rebuild.
    const width = Number(parameters.width); // Becomes the collider's full horizontal size in model units.
    const height = Number(parameters.height); // Becomes the collider's full vertical size in model units.
    return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 ? { width, height } : null;
  }

  function syncCreaturePngColliderDimensions(backdrop) {
    if (backdrop?.getPreviewMode?.() !== 'creature') return null;
    const model = backdrop.getAvatarModel?.(); // Receives the exact animal group currently shown by the procedural preview.
    const dimensions = creaturePngPlaneDimensions(model); // Avoids the rotated two-plane group's misleading world-axis bounding box.
    if (!model || !dimensions) return null;
    const changed = model.userData?.portraitModelWidth !== dimensions.width || model.userData?.portraitModelHeight !== dimensions.height; // Rebuilds only when a new PNG plane has different authored dimensions.
    model.userData.portraitModelWidth = dimensions.width;
    model.userData.portraitModelHeight = dimensions.height;
    model.userData.authoringColliderPngDimensions = { ...dimensions, yawDegrees: 90 }; // Makes the mobile/scene diagnostic source inspectable without DevTools.
    if (changed) console.info(`[Impact collider] PNG plane dimensions: ${dimensions.width.toFixed(3)} × ${dimensions.height.toFixed(3)}; Y rotation: 90°.`);
    return dimensions;
  }

  function installCreatureColliderOrientationSync() {
    let colliderVisual = null; // Caches the current cyan authoring group until the ragdoll tool replaces or disposes it.
    let appliedMode = ''; // Avoids rewriting child transforms every animation frame when preview type is unchanged.

    function syncColliderOrientation() {
      const backdrop = window.HobunjiGameplayBackdrop; // Exposes the current preview mode and Three.js scene without reaching into editor-private state.
      const scene = backdrop?.getScene?.(); // Locates the authoring collider by its existing diagnostic object name.
      if (!scene) {
        requestAnimationFrame(syncColliderOrientation);
        return;
      }
      const pngDimensions = syncCreaturePngColliderDimensions(backdrop); // Feeds exact animal dimensions into the existing physics and cyan-visual collider builders.
      if (!colliderVisual?.parent) {
        colliderVisual = scene.getObjectByName('AuthoringPhysicsPortraitCollider') || null;
        appliedMode = '';
      }
      const previewMode = backdrop.getPreviewMode?.() === 'creature' ? 'creature' : 'npc'; // Animals need their side-on sprite plane reflected in the cyan collider.
      if (colliderVisual && appliedMode !== previewMode) {
        const yaw = previewMode === 'creature' ? Math.PI * 0.5 : 0; // Rotates only the collider geometry, not the animal or simulated body.
        colliderVisual.children.forEach((child) => { child.rotation.y = yaw; });
        colliderVisual.userData.previewPlaneYawDegrees = previewMode === 'creature' ? 90 : 0;
        appliedMode = previewMode;
        if (previewMode === 'creature') updateVisibleStatus(`Animal collider: ${pngDimensions ? `${pngDimensions.width.toFixed(3)} × ${pngDimensions.height.toFixed(3)} · ` : ''}Y +90°.`);
        console.info(`[Impact collider] ${previewMode} authoring plane Y rotation: ${colliderVisual.userData.previewPlaneYawDegrees}°.`);
      }
      requestAnimationFrame(syncColliderOrientation);
    }

    requestAnimationFrame(syncColliderOrientation);
    window.addEventListener('hobunji-backdrop-creature-changed', () => {
      syncCreaturePngColliderDimensions(window.HobunjiGameplayBackdrop); // Applies dimensions immediately when asynchronous creature rendering completes.
      colliderVisual = null;
      appliedMode = '';
    });
  }

  function buildImpactWorkspace() {
    const panel = document.getElementById('footingPanel'); // Becomes the modal container while retaining its existing event listeners.
    const body = panel?.querySelector(':scope > .authoringBody'); // Contains the old authoring content and nested blendspace accordion.
    const modalRoot = document.getElementById('gameModalOverlayRoot'); // Keeps the workspace inside the visible full-viewport UI layer.
    const actionRow = document.querySelector('#animationHud .animationHudActions'); // Receives the always-visible Impact entry button.
    if (!panel || !body || !modalRoot || !actionRow || panel.dataset.impactTabsReady === 'true') return;

    const nestedBlendspace = [...body.children].find((child) => child.tagName === 'DETAILS' && /baked impact blend space/i.test(child.querySelector(':scope > summary')?.textContent || '')); // Finds the inaccessible nested section by its stable heading.
    if (!nestedBlendspace) {
      console.error('[Impact tabs] Baked impact blend space section was not found.');
      updateVisibleStatus('Impact tabs could not find the blendspace section.');
      return;
    }

    panel.dataset.impactTabsReady = 'true';
    injectImpactWorkspaceStyles();

    const tabList = document.createElement('nav'); // Provides top-level navigation between authoring and blendspace views.
    tabList.className = 'impactWorkspaceTabs';
    tabList.setAttribute('role', 'tablist');
    tabList.setAttribute('aria-label', 'Impact animation workspace');
    const authoringTab = makeTab('impactAuthoringTab', 'Impact authoring', 'authoring', 'impactAuthoringTabPanel', true); // Opens live physics and Footing controls.
    const blendspaceTab = makeTab('impactBlendspaceTab', 'Impact blendspace', 'blendspace', 'impactBlendspaceTabPanel', false); // Opens baked four-way blend controls.
    tabList.append(authoringTab, blendspaceTab);

    const authoringPanel = document.createElement('section'); // Groups all controls that formerly preceded the nested blendspace.
    authoringPanel.id = 'impactAuthoringTabPanel';
    authoringPanel.className = 'impactTabPanel';
    authoringPanel.setAttribute('role', 'tabpanel');
    authoringPanel.setAttribute('aria-labelledby', authoringTab.id);
    while (body.firstChild && body.firstChild !== nestedBlendspace) authoringPanel.appendChild(body.firstChild);

    const blendspacePanel = document.createElement('section'); // Replaces the nested accordion while preserving its original control nodes.
    blendspacePanel.id = 'impactBlendspaceTabPanel';
    blendspacePanel.className = 'impactTabPanel';
    blendspacePanel.hidden = true;
    blendspacePanel.setAttribute('role', 'tabpanel');
    blendspacePanel.setAttribute('aria-labelledby', blendspaceTab.id);
    const nestedSummary = nestedBlendspace.querySelector(':scope > summary'); // Removes only the obsolete accordion heading.
    [...nestedBlendspace.childNodes].forEach((node) => {
      if (node !== nestedSummary) blendspacePanel.appendChild(node);
    });
    nestedBlendspace.replaceWith(blendspacePanel);
    body.prepend(tabList, authoringPanel);

    const quickButton = document.createElement('button'); // Opens directly to the blendspace from the visible playback HUD.
    quickButton.id = 'footingQuickBtn';
    quickButton.type = 'button';
    quickButton.className = 'secondary';
    quickButton.textContent = 'Impact';
    quickButton.addEventListener('click', () => {
      panel.open = true;
      selectImpactTab(panel, 'blendspace', false);
      updateVisibleStatus('Impact blendspace tab opened.');
    });
    actionRow.appendChild(quickButton);

    tabList.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-impact-tab]'); // Ignores clicks in the tab bar that are not on a tab button.
      if (tab) selectImpactTab(panel, tab.dataset.impactTab, false);
    });
    tabList.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const nextTab = event.key === 'ArrowLeft' || event.key === 'Home' ? 'authoring' : 'blendspace'; // Maps the compact two-tab keyboard order.
      selectImpactTab(panel, nextTab, true);
    });
    panel.addEventListener('toggle', () => quickButton.classList.toggle('active', panel.open));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && panel.open) panel.open = false;
    });

    modalRoot.appendChild(panel);
    const modalObserver = new MutationObserver(() => { // Restores this tool-owned workspace if preview code clears injected modal children.
      if (!modalRoot.contains(panel)) {
        panel.open = false;
        modalRoot.appendChild(panel);
      }
    });
    modalObserver.observe(modalRoot, { childList: true });
    selectImpactTab(panel, 'authoring', false);
    installCreatureColliderOrientationSync();
    console.info('[Impact tabs] Tabbed authoring workspace ready; existing control nodes and handlers preserved.');
  }

  loadLimbPoseAuthor();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildImpactWorkspace, { once: true });
  else buildImpactWorkspace();
})();
