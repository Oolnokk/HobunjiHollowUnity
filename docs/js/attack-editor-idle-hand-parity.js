// Keeps Attack Editor weapon-idle previews on the same hand/stance path as gameplay.
// Also reorganizes the editor sidebar around the authoring workflow without cloning
// controls: existing DOM nodes are moved so their original listeners/state stay live.
(function (global) {
  'use strict';

  const poseRuntime = global.HobunjiHandShoulderPoseRuntime; // Supplies the same idle weights used by gameplay.
  let idlePreviewActive = false; // Read by the wrapped shoulder controls while a weapon-idle pose is being previewed.
  let controlsPatched = false; // Prevents wrapping the editor shoulder controls more than once.
  let listenersInstalled = false; // Prevents duplicate DOM listeners while the adapter waits for late editor controls.
  let suppressTimelineClear = false; // Keeps our own forced Neutral scrub from immediately cancelling idle-preview mode.
  let layoutQueued = false; // Coalesces dynamic-editor mutations into one sidebar-layout pass per frame.
  let workflowListenersInstalled = false; // Prevents duplicate quick-navigation/stance-tab event delegation.

  const STANCE_BY_PRESET = Object.freeze({
    heavy_weapon_idle: 'heavyWeapon',
    light_weapon_idle: 'lightWeapon',
  }); // Maps legacy still-preset IDs to the shared idle-stance config keys.
  const POSE_KEYS = Object.freeze(['x', 'y', 'z', 'pitch', 'yaw', 'roll', 'bodyYaw']); // Copied into all three still-preset phases below.
  const FALLBACK_STANCES = Object.freeze({
    heavyWeapon: Object.freeze({ x: 0.03, y: 0.37, z: -0.01, pitch: -155, yaw: -79, bodyYaw: -15, roll: -82 }),
    lightWeapon: Object.freeze({ x: 0.04, y: 0, z: 0, pitch: 20, yaw: -70, bodyYaw: -40, roll: -65 }),
  }); // Used only if the shared Idle Stance editor has not finished loading yet.
  const QUICK_NAV_ITEMS = Object.freeze([
    ['Weapon', 'weapon'],
    ['Stances', 'stances'],
    ['Attack', 'attack'],
    ['Grip', 'grip'],
    ['Stats', 'stats'],
    ['Avatar', 'avatar'],
    ['Export', 'export'],
  ]); // Defines the sticky mobile-friendly jump bar shown at the top of the sidebar.

  function idleWeights() {
    const runtimeIdle = poseRuntime?.idle || { pitch: 1, yaw: 0, roll: 1 }; // Returned during resting-stance previews to match gameplay exactly.
    return { pitch: Number(runtimeIdle.pitch) || 0, yaw: Number(runtimeIdle.yaw) || 0, roll: Number(runtimeIdle.roll) || 0 };
  }

  function syncHands() {
    global.ProceduralHandFrameDriver?.syncNow?.();
  }

  function forceNeutralScrub() {
    const button = document.getElementById('scrubNeutralBtn'); // Uses the editor's own scrub function so previewT and marker stay in sync.
    suppressTimelineClear = true;
    try { button?.click(); }
    finally { queueMicrotask(() => { suppressTimelineClear = false; }); }
  }

  function setIdlePreview(active) {
    idlePreviewActive = !!active;
    if (idlePreviewActive) forceNeutralScrub();
    syncHands();
  }

  function currentSharedStance(stanceKey) {
    const editorConfig = global.AttackIdleStanceEditor?.getConfig?.(); // Preferred because it includes the same Local Override the game reads.
    return editorConfig?.stances?.[stanceKey] || FALLBACK_STANCES[stanceKey] || null;
  }

  function writeStillPoseFromSharedConfig(presetId) {
    const stanceKey = STANCE_BY_PRESET[presetId]; // Selects Heavy/Light config for the legacy still preset that was just loaded.
    const pose = stanceKey ? currentSharedStance(stanceKey) : null; // Applied below to Neutral/Windup/Strike so a still pose cannot interpolate away.
    if (!pose) return false;

    for (const phase of ['neutral', 'windup', 'strike']) {
      for (const key of POSE_KEYS) {
        const input = document.getElementById(`${phase}_${key}`); // Existing core pose input; dispatching input updates the module-scoped animation data too.
        const value = Number(pose[key]); // Validated before replacing the field so malformed local data cannot poison the preview.
        if (!input || !Number.isFinite(value)) continue;
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    return true;
  }

  function patchShoulderControls() {
    const controls = global.HobunjiAttackEditorHandShoulderControls; // Existing per-pose shoulder UI installed by attack-editor-hand-shoulder-controls.js.
    if (!controls || controlsPatched) return false;
    const originalCurrentWeights = controls.currentWeights?.bind(controls); // Retained for all normal attack playback/scrubbing.
    if (!originalCurrentWeights) return false;

    controls.currentWeights = function idleParityCurrentWeights() {
      return idlePreviewActive ? idleWeights() : originalCurrentWeights();
    };
    controlsPatched = true;
    return true;
  }

  function installListeners() {
    if (listenersInstalled) return true;
    const loadPreset = document.getElementById('loadPresetBtn'); // Legacy preset loader patched below after its own click handler runs.
    const presetSelect = document.getElementById('presetSelect'); // Tells us whether Heavy/Light still is the requested legacy preset.
    const idleEdit = document.getElementById('idleEditNeutralBtn'); // Separate Idle Stances editor toggle; active means it must look like gameplay idle.
    const idlePreview = document.getElementById('idlePreviewBtn'); // One-shot Idle Stances preview also needs gameplay idle hand weights.
    const scrub = document.getElementById('scrub'); // Any manual timeline motion returns ownership to attack-pose shoulder weights.
    const play = document.getElementById('playPauseBtn'); // Playing the attack exits the special resting-stance preview.
    if (!loadPreset || !presetSelect || !scrub || !play) return false;

    loadPreset.addEventListener('click', () => {
      const presetId = presetSelect.value; // Captured before the deferred parity pass below.
      const stanceKey = STANCE_BY_PRESET[presetId]; // Non-weapon-idle presets should use ordinary attack shoulder behavior.
      if (!stanceKey) {
        setIdlePreview(false);
        return;
      }
      setTimeout(() => {
        writeStillPoseFromSharedConfig(presetId);
        setIdlePreview(true);
      }, 0);
    });

    presetSelect.addEventListener('change', () => setIdlePreview(false));
    idleEdit?.addEventListener('click', () => {
      setTimeout(() => setIdlePreview(idleEdit.classList.contains('active')), 0);
    });
    idlePreview?.addEventListener('click', () => setTimeout(() => setIdlePreview(true), 0));

    const clearForTimeline = () => {
      if (!suppressTimelineClear) setIdlePreview(false);
    }; // Shared by timeline controls that mean the user has resumed attack previewing.
    scrub.addEventListener('input', clearForTimeline);
    play.addEventListener('click', clearForTimeline);
    document.getElementById('scrubWindupBtn')?.addEventListener('click', clearForTimeline);
    document.getElementById('scrubStrikeBtn')?.addEventListener('click', clearForTimeline);
    document.getElementById('scrubNeutralBtn')?.addEventListener('click', clearForTimeline);

    listenersInstalled = true;
    return true;
  }

  function cardByTitle(pattern) {
    const sidebar = document.getElementById('sidebar'); // Restricts title matching to top-level editor sections.
    const cards = sidebar ? [...sidebar.querySelectorAll(':scope > .card')] : []; // Reused below to find static cards after they may have been reordered.
    return cards.find(card => pattern.test(card.querySelector('.sectionTitle b')?.textContent?.trim() || '')) || null;
  }

  function sectionBodyNodes(card) {
    const nodes = card ? [...card.children] : []; // Snapshot prevents live-collection mutation while controls are moved between cards.
    return nodes.filter(node => !node.classList?.contains('sectionTitle'));
  }

  function ensureWorkflowStyles() {
    if (document.getElementById('attackEditorWorkflowStyles')) return;
    const style = document.createElement('style'); // Holds layout-only rules so the core editor stylesheet remains untouched.
    style.id = 'attackEditorWorkflowStyles';
    style.textContent = `
      #attackEditorQuickNav{
        position:sticky;top:0;z-index:40;display:flex;gap:5px;overflow-x:auto;
        margin:0;padding:8px 10px;background:rgba(11,15,20,.96);
        border-bottom:1px solid var(--line);backdrop-filter:blur(7px);
        scrollbar-width:thin;
      }
      #attackEditorQuickNav button{
        flex:0 0 auto;padding:6px 8px;border-radius:9px;font-size:11px;white-space:nowrap;
      }
      #sidebar > .card{scroll-margin-top:52px}
      .workflowGroup{
        border:1px solid rgba(255,255,255,.10);border-radius:10px;
        padding:8px;margin:8px 0;background:rgba(255,255,255,.022);
      }
      .workflowGroupTitle{
        display:flex;align-items:center;justify-content:space-between;gap:8px;
        margin-bottom:7px;font-size:11px;font-weight:800;text-transform:uppercase;
        letter-spacing:.28px;color:var(--text);
      }
      .weaponStanceTabs{display:flex;gap:7px;margin:4px 0 9px}
      .weaponStanceTabs button{flex:1;min-width:0}
      .weaponStanceTabs button.active{
        border-color:rgba(34,211,238,.75);background:rgba(34,211,238,.20);
      }
      .workflowDetails{
        border:1px solid rgba(255,255,255,.10);border-radius:9px;
        padding:0 8px;margin:8px 0;background:rgba(0,0,0,.09);
      }
      .workflowDetails > summary{
        cursor:pointer;list-style:none;padding:8px 1px;font-size:11px;
        font-weight:750;color:var(--muted);
      }
      .workflowDetails > summary::-webkit-details-marker{display:none}
      .workflowDetails > summary::before{content:'▸';display:inline-block;width:15px}
      .workflowDetails[open] > summary::before{content:'▾'}
      .workflowDetails > :not(summary):last-child{margin-bottom:8px}
      #workflowAttackControls .row button{flex:1}
      #workflowGizmoControls .row button{flex:1}
      @media(max-width:760px){
        #attackEditorQuickNav{padding-left:7px;padding-right:7px}
        #attackEditorQuickNav button{padding:7px 8px}
      }
    `;
    document.head.appendChild(style);
  }

  function ensureQuickNav(sidebar) {
    let nav = document.getElementById('attackEditorQuickNav'); // Reused between mutation-driven layout passes.
    if (!nav) {
      nav = document.createElement('nav');
      nav.id = 'attackEditorQuickNav';
      nav.setAttribute('aria-label', 'Attack editor section shortcuts');
      nav.innerHTML = QUICK_NAV_ITEMS.map(([label, key]) => (
        `<button type="button" class="secondary" data-workflow-target="${key}">${label}</button>`
      )).join('');
      sidebar.insertBefore(nav, sidebar.firstChild);
    }
    return nav;
  }

  function workflowTarget(key) {
    if (key === 'weapon') return cardByTitle(/^(Tool \/ held action animation|Weapon \/ Attack)$/i);
    if (key === 'stances') return document.getElementById('idleStanceCard');
    if (key === 'attack') return cardByTitle(/^Pose editor$/i);
    if (key === 'grip') return document.getElementById('handPrimaryGripGroup')?.closest('.card')
      || document.getElementById('handProfileSelect')?.closest('.card');
    if (key === 'stats') return cardByTitle(/^Combat stats$/i);
    if (key === 'avatar') return cardByTitle(/^Avatar$/i);
    if (key === 'export') return cardByTitle(/^Actions$/i);
    return null;
  }

  function updateWeaponStanceButtons() {
    const select = document.getElementById('idleStanceSelect'); // Current shared idle-stance selection controls which quick tab is highlighted.
    const buttons = document.querySelectorAll('#weaponStanceQuickButtons [data-idle-stance]'); // Both Light/Heavy quick tabs are synchronized here.
    for (const button of buttons) button.classList.toggle('active', button.dataset.idleStance === select?.value);
  }

  function installWorkflowListeners(sidebar) {
    if (workflowListenersInstalled) return;
    sidebar.addEventListener('click', event => {
      const navButton = event.target?.closest?.('[data-workflow-target]'); // Sticky jump-bar button handled without per-button listeners.
      if (navButton) {
        const target = workflowTarget(navButton.dataset.workflowTarget); // Resolves late-added dynamic cards at click time.
        target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        return;
      }

      const stanceButton = event.target?.closest?.('[data-idle-stance]'); // Light/Heavy tabs select the real shared stance editor, not a duplicated pose.
      if (!stanceButton) return;
      const select = document.getElementById('idleStanceSelect'); // Existing select remains the single source of selection truth.
      if (!select) return;
      select.value = stanceButton.dataset.idleStance;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('idlePreviewBtn')?.click();
      setIdlePreview(true);
      updateWeaponStanceButtons();
    });

    sidebar.addEventListener('change', event => {
      if (event.target?.id === 'idleStanceSelect') updateWeaponStanceButtons();
    });
    workflowListenersInstalled = true;
  }

  function ensureWeaponStanceWorkflow() {
    const card = document.getElementById('idleStanceCard'); // Dynamic shared idle-stance card becomes the dedicated Light/Heavy weapon-stance section.
    const select = document.getElementById('idleStanceSelect'); // Existing select still exposes Tool/Hoe via the advanced disclosure below.
    const fields = document.getElementById('idleStanceFields'); // Existing live field host remains visible for whichever stance the tabs select.
    if (!card || !select || !fields) return;

    const title = card.querySelector('.sectionTitle b'); // Retitled to match the two weapon stances now promoted by this workflow.
    const tag = card.querySelector('.sectionTag'); // Clarifies that Tool/Hoe rests remain available but secondary.
    if (title) title.textContent = 'Weapon Stances';
    if (tag) tag.textContent = 'light / heavy';

    let tabs = document.getElementById('weaponStanceQuickButtons'); // Visible Light/Heavy buttons inserted once above the stance sliders.
    if (!tabs) {
      tabs = document.createElement('div');
      tabs.id = 'weaponStanceQuickButtons';
      tabs.className = 'weaponStanceTabs';
      tabs.innerHTML = `
        <button type="button" class="secondary" data-idle-stance="lightWeapon">Light stance</button>
        <button type="button" class="secondary" data-idle-stance="heavyWeapon">Heavy stance</button>
      `;
      card.querySelector('.sectionTitle')?.insertAdjacentElement('afterend', tabs);
    }

    let otherDetails = document.getElementById('otherIdleStancesDetails'); // Collapses Tool/Hoe selection so weapon stance editing stays visually primary.
    if (!otherDetails) {
      otherDetails = document.createElement('details');
      otherDetails.id = 'otherIdleStancesDetails';
      otherDetails.className = 'workflowDetails';
      otherDetails.innerHTML = '<summary>Other tool rests (tool / hoe)</summary>';
      fields.insertAdjacentElement('afterend', otherDetails);
    }
    const selectField = select.closest('.field'); // Existing selector is moved, retaining its change listener and current selection.
    if (selectField && selectField.parentElement !== otherDetails) otherDetails.appendChild(selectField);

    let fileDetails = document.getElementById('idleStanceFileDetails'); // Keeps download/override maintenance controls out of the frequent stance-editing path.
    if (!fileDetails) {
      fileDetails = document.createElement('details');
      fileDetails.id = 'idleStanceFileDetails';
      fileDetails.className = 'workflowDetails';
      fileDetails.innerHTML = '<summary>Idle stance files / overrides</summary>';
      const downloadButton = document.getElementById('idleDownloadBtn'); // Identifies the existing download/copy row to move without recreating buttons.
      const overrideButton = document.getElementById('idleSaveOverrideBtn'); // Identifies the existing local-override row to move with its listeners intact.
      const downloadRow = downloadButton?.closest('.row'); // Existing JSON file controls moved into the disclosure below.
      const overrideRow = overrideButton?.closest('.row'); // Existing local override controls moved into the same disclosure.
      if (downloadRow) fileDetails.appendChild(downloadRow);
      if (overrideRow) fileDetails.appendChild(overrideRow);
      const status = document.getElementById('idleStanceStatus'); // Status remains immediately below the collapsed maintenance section.
      if (status) status.insertAdjacentElement('beforebegin', fileDetails);
      else card.appendChild(fileDetails);
    }

    updateWeaponStanceButtons();
  }

  function consolidateAttackControls() {
    const poseCard = cardByTitle(/^Pose editor$/i); // Destination for playback, timing and gizmo controls that all edit the same animation.
    if (!poseCard) return;

    const title = poseCard.querySelector('.sectionTitle b'); // Shorter title emphasizes this as the main attack-authoring section.
    const tag = poseCard.querySelector('.sectionTag'); // Updated tag describes the consolidated scope instead of only the three pose panels.
    if (title) title.textContent = 'Pose editor';
    if (tag) tag.textContent = 'playback / timing / poses / gizmo';

    let attackControls = document.getElementById('workflowAttackControls'); // Playback+timing group is kept open because both are frequently used.
    if (!attackControls) {
      attackControls = document.createElement('div');
      attackControls.id = 'workflowAttackControls';
      attackControls.className = 'workflowGroup';
      attackControls.innerHTML = '<div class="workflowGroupTitle"><span>Playback & timing</span><span class="sectionTag">frequent</span></div>';
      const timeline = document.getElementById('timeline'); // Inserts controls immediately before the visual timeline and pose panels.
      if (timeline) poseCard.insertBefore(attackControls, timeline);
      else poseCard.querySelector('.sectionTitle')?.insertAdjacentElement('afterend', attackControls);
    }

    const playbackCard = cardByTitle(/^Playback$/i); // Standalone playback card is redundant with the pose timeline.
    if (playbackCard) {
      for (const node of sectionBodyNodes(playbackCard)) attackControls.appendChild(node);
      playbackCard.remove();
    }

    const timingCard = cardByTitle(/^Timing$/i); // Standalone timing card is redundant with the same pose timeline.
    if (timingCard) {
      if (attackControls.children.length > 1 && !document.getElementById('workflowTimingDivider')) {
        const divider = document.createElement('div'); // Visually separates playback transport from timing sliders inside one card.
        divider.id = 'workflowTimingDivider';
        divider.className = 'hr';
        attackControls.appendChild(divider);
      }
      for (const node of sectionBodyNodes(timingCard)) attackControls.appendChild(node);
      timingCard.remove();
    }

    let gizmoGroup = document.getElementById('workflowGizmoControls'); // 3D gizmo remains near pose sliders instead of living several cards away.
    if (!gizmoGroup) {
      const gizmoCard = cardByTitle(/^3D Gizmo$/i); // Existing gizmo card supplies live controls/listeners moved below the pose fields.
      if (gizmoCard) {
        gizmoGroup = document.createElement('div');
        gizmoGroup.id = 'workflowGizmoControls';
        gizmoGroup.className = 'workflowGroup';
        gizmoGroup.innerHTML = '<div class="workflowGroupTitle"><span>Viewport gizmo</span><span class="sectionTag">move / rotate</span></div>';
        for (const node of sectionBodyNodes(gizmoCard)) gizmoGroup.appendChild(node);
        poseCard.appendChild(gizmoGroup);
        gizmoCard.remove();
      }
    }
  }

  function demoteLegacyPresets() {
    const metaCard = cardByTitle(/^(Tool \/ held action animation|Weapon \/ Attack)$/i); // Primary weapon/animation metadata card receives infrequent legacy presets.
    const presetCard = cardByTitle(/^Tool stance presets$/i); // Old preset card duplicates Light/Heavy idle stance access and sits in the middle of the workflow.
    if (!metaCard) return;

    const title = metaCard.querySelector('.sectionTitle b'); // Renamed to match its new role as the editor's starting weapon/attack section.
    const tag = metaCard.querySelector('.sectionTag'); // Compact tag reflects the merged weapon/preset metadata.
    if (title) title.textContent = 'Weapon / Attack';
    if (tag) tag.textContent = 'select / preset';

    if (presetCard && !document.getElementById('otherAttackPresetsDetails')) {
      const details = document.createElement('details'); // Legacy swing/tool presets remain available without occupying a full always-open section.
      details.id = 'otherAttackPresetsDetails';
      details.className = 'workflowDetails';
      details.innerHTML = '<summary>Other attack / tool presets</summary>';
      for (const node of sectionBodyNodes(presetCard)) details.appendChild(node);
      metaCard.appendChild(details);
      presetCard.remove();
    }

    const presetSelect = document.getElementById('presetSelect'); // Legacy Heavy/Light still options are hidden because the real stance editor is now promoted above.
    for (const option of presetSelect?.options || []) {
      if (!STANCE_BY_PRESET[option.value]) continue;
      option.hidden = true;
      option.disabled = true;
    }
  }

  function collapseAvatarDiagnostics() {
    const avatarCard = cardByTitle(/^Avatar$/i); // Species/Gender stay visible while neck-skin diagnostics are demoted.
    if (!avatarCard || document.getElementById('avatarAdvancedPreviewDetails')) return;
    const neckStrength = document.getElementById('neckStrength')?.closest('.field'); // Existing neck strength field moved with its listener intact.
    const neckRadius = document.getElementById('neckRadius')?.closest('.field'); // Existing weight-radius field moved with its listener intact.
    const headVertices = document.getElementById('showHeadSkinVertices')?.closest('.field'); // Existing head-skin diagnostic toggle moved intact.
    if (!neckStrength && !neckRadius && !headVertices) return;

    const details = document.createElement('details'); // Collapses preview-only head diagnostics that are not part of most attack authoring.
    details.id = 'avatarAdvancedPreviewDetails';
    details.className = 'workflowDetails';
    details.innerHTML = '<summary>Advanced head / neck preview</summary>';
    if (neckStrength) details.appendChild(neckStrength);
    if (neckRadius) details.appendChild(neckRadius);
    if (headVertices) details.appendChild(headVertices);
    const help = [...avatarCard.querySelectorAll(':scope > .help')].pop(); // Long diagnostic explanation follows the controls it documents.
    if (help) details.appendChild(help);
    avatarCard.appendChild(details);
  }

  function collapseCombatMaintenance() {
    const statsCard = cardByTitle(/^Combat stats$/i); // Core attack selector/fields/hitbox stay open; file plumbing moves below.
    if (!statsCard || document.getElementById('combatMaintenanceDetails')) return;
    const details = document.createElement('details'); // Reduces vertical height from download/copy/override controls used much less often than stats.
    details.id = 'combatMaintenanceDetails';
    details.className = 'workflowDetails';
    details.innerHTML = '<summary>Combat config / overrides</summary>';

    const downloadRow = document.getElementById('statsDownloadBtn')?.closest('.row'); // Existing config export row moved with listeners intact.
    const overrideRow = document.getElementById('statsSaveOverrideBtn')?.closest('.row'); // Existing override row moved with listeners intact.
    const overrideStatus = document.getElementById('statsOverrideStatus'); // Override status belongs with its maintenance controls.
    const explanatoryHelp = [...statsCard.querySelectorAll(':scope > .help')].find(node => node !== overrideStatus); // Long file/config explanation is secondary to live stat editing.
    if (explanatoryHelp) details.appendChild(explanatoryHelp);
    if (downloadRow) details.appendChild(downloadRow);
    if (overrideRow) details.appendChild(overrideRow);
    if (overrideStatus) details.appendChild(overrideStatus);
    statsCard.appendChild(details);
  }

  function collapseActionDiagnostics() {
    const actionsCard = cardByTitle(/^Actions$/i); // Primary flip/reset/import/export buttons stay exposed at the bottom.
    if (!actionsCard || document.getElementById('actionDiagnosticsDetails')) return;
    const firstDivider = actionsCard.querySelector(':scope > .hr'); // Everything after the first divider is JSON/transform diagnostic material.
    if (!firstDivider) return;

    const details = document.createElement('details'); // Hides large readonly textareas until debugging/export inspection is actually needed.
    details.id = 'actionDiagnosticsDetails';
    details.className = 'workflowDetails';
    details.innerHTML = '<summary>JSON & transform diagnostics</summary>';
    const diagnosticNodes = []; // Snapshot of trailing nodes prevents sibling iteration from breaking as nodes are moved.
    for (let node = firstDivider; node; node = node.nextElementSibling) diagnosticNodes.push(node);
    for (const node of diagnosticNodes) details.appendChild(node);
    actionsCard.appendChild(details);
  }

  function promoteGripControls() {
    const gripGroup = document.getElementById('handPrimaryGripGroup'); // Frequently edited weapon grip/spans should be first inside the larger hand card.
    const handCard = gripGroup?.closest('.card') || document.getElementById('handProfileSelect')?.closest('.card'); // Dynamic hand card can arrive after initial layout.
    if (!gripGroup || !handCard) return;
    const sectionTitle = handCard.querySelector('.sectionTitle'); // Grip group is inserted after the card's intro instead of after model/debug configuration.
    const introHelp = sectionTitle?.nextElementSibling?.classList?.contains('help') ? sectionTitle.nextElementSibling : null; // Preserves one explanatory sentence before frequent grip controls.
    const anchor = introHelp || sectionTitle; // Stable insertion anchor used whether the hand card has introductory help or not.
    if (anchor && anchor.nextElementSibling !== gripGroup) anchor.insertAdjacentElement('afterend', gripGroup);
  }

  function reorderWorkflowCards(sidebar, nav) {
    const metaCard = cardByTitle(/^(Tool \/ held action animation|Weapon \/ Attack)$/i); // First workflow step: choose weapon/action.
    const stanceCard = document.getElementById('idleStanceCard'); // Second: edit Light/Heavy resting weapon stance.
    const poseCard = cardByTitle(/^Pose editor$/i); // Third: author playback/timing/poses/gizmo.
    const handCard = document.getElementById('handPrimaryGripGroup')?.closest('.card')
      || document.getElementById('handProfileSelect')?.closest('.card'); // Fourth: author primary/off-hand grip behavior.
    const statsCard = cardByTitle(/^Combat stats$/i); // Fifth: optional attack gameplay values.
    const avatarCard = cardByTitle(/^Avatar$/i); // Sixth: preview identity and advanced head diagnostics.
    const actionsCard = cardByTitle(/^Actions$/i); // Last: import/export/debug.
    const ordered = [metaCard, stanceCard, poseCard, handCard, statsCard, avatarCard, actionsCard].filter(Boolean); // Canonical top-to-bottom authoring order.

    let anchor = nav; // Each known card is inserted after the previous workflow step while preserving unknown extension cards below.
    for (const card of ordered) {
      if (anchor.nextElementSibling !== card) anchor.insertAdjacentElement('afterend', card);
      anchor = card;
    }
  }

  function applyWorkflowLayout() {
    const sidebar = document.getElementById('sidebar'); // Main scroll container whose cards are reorganized below.
    if (!sidebar) return;
    ensureWorkflowStyles();
    const nav = ensureQuickNav(sidebar); // Sticky jump bar makes every frequent section reachable without manual long scrolling.
    installWorkflowListeners(sidebar);
    demoteLegacyPresets();
    consolidateAttackControls();
    ensureWeaponStanceWorkflow();
    promoteGripControls();
    collapseCombatMaintenance();
    collapseAvatarDiagnostics();
    collapseActionDiagnostics();
    reorderWorkflowCards(sidebar, nav);
  }

  function scheduleWorkflowLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    global.requestAnimationFrame(() => {
      layoutQueued = false;
      applyWorkflowLayout();
    });
  }

  function installLayoutObserver() {
    const sidebar = document.getElementById('sidebar'); // Observed because idle stances, hand controls, and pose fields are installed asynchronously.
    if (!sidebar || sidebar.dataset.workflowLayoutObserved === '1') return;
    sidebar.dataset.workflowLayoutObserved = '1';
    const observer = new MutationObserver(scheduleWorkflowLayout); // Reapplies only structural moves when dynamic editor extensions appear.
    observer.observe(sidebar, { childList: true, subtree: true });
    scheduleWorkflowLayout();
  }

  function boot() {
    patchShoulderControls();
    installListeners();
    installLayoutObserver();
    if (!controlsPatched || !listenersInstalled) global.requestAnimationFrame(boot);
  }
  boot();

  global.HobunjiAttackEditorIdleHandParity = {
    get active() { return idlePreviewActive; },
    forcePreview(presetId) {
      if (STANCE_BY_PRESET[presetId]) writeStillPoseFromSharedConfig(presetId);
      setIdlePreview(true);
    },
    clear() { setIdlePreview(false); },
    refreshLayout: scheduleWorkflowLayout,
    getDebug() {
      return {
        active: idlePreviewActive,
        shoulderWeights: idlePreviewActive ? idleWeights() : null,
        controlsPatched,
        listenersInstalled,
        workflowLayout: !!document.getElementById('attackEditorQuickNav'),
      };
    },
  };
})(window);
