// Ordinary gameplay Farmwork manager. Uses FarmPlotEditor records + FarmEditor's existing grid access,
// but never enables the dev terrain painter. Plots are painted in the world and previewed as individual silhouettes.
(() => {
  'use strict';
  if (window.FarmworkUI) return;

  const SIZE = 7; // Maximum plot footprint in either dimension (the former single-page size).
  let open = false; // Used by the utility wheel, controller panel and farm-world pointer bridge.
  let planning = false; // The temporary planning tool owns actions while the settings panel is tucked away.
  let planningMode = 'plot'; // World Action 1/2 can edit plot membership or selected seed-block membership.
  let selectedBlockId = null; // The chosen seed block in the active planting field (not a new persisted state).
  let visualGroup = null, visualScene = null, lastVisualAt = -Infinity;
  let visualPlots = null, visualTiles = [];
  let highlightRoots = [];
  let drag = null; // World pointer drag: { pointerId, plotId, adding, changed } to commit exactly once.
  let confirmDeleteId = null; // Two-press remove guard usable with controller A, without a native browser confirm modal.
  const pane = () => document.getElementById('farmworkPanel'); // Existing markup registers with ControllerUiNav via data-ctrl-panel.
  const manager = () => window.FarmPlotEditor; // All edits route through the single persisted family-plot owner.
  const context = () => window.FarmEditor?.farmworkTileAccess?.(); // Farm bounds, house collision and world-pointer projection remain in FarmEditor.
  const esc = value => String(value ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const plot = () => manager()?.activeFamilyPlot?.();
  const block = () => plot()?.seedBlocks?.find(b => b.id === selectedBlockId) || null;
  const canOpen = () => !!(window.RomanceSystem?.getSpouse?.()?.npcId && context()?.editable);

  function bounds(p) {
    if (!p?.tiles?.length) return null;
    return { c: Math.min(...p.tiles.map(t => t[0])), r: Math.min(...p.tiles.map(t => t[1])),
      maxC: Math.max(...p.tiles.map(t => t[0])), maxR: Math.max(...p.tiles.map(t => t[1])) };
  }
  function fits(p, c, r) {
    const b = bounds(p);
    return !b || (Math.max(b.maxC, c) - Math.min(b.c, c) < SIZE && Math.max(b.maxR, r) - Math.min(b.r, r) < SIZE);
  }
  function setPlanning(next, mode = 'plot') {
    endDrag();
    planningMode = next && mode === 'block' && block() ? 'block' : 'plot';
    planning = !!next && open && canOpen() && !!plot();
    if (pane()) pane().style.display = open && !planning ? 'flex' : 'none';
    const hud = document.getElementById('farmworkToolHud');
    if (hud) {
      hud.style.display = planning ? 'flex' : 'none';
      const status = hud.querySelector('span');
      if (status) status.textContent = planningMode === 'block' ? 'Seed block selection · Action 1: add included tile · Action 2: remove' : 'Plot planning · Action 1: add · Action 2: remove';
    }
    window.WorldActionInputClaims?.clearClaims?.('farmwork-planning');
    if (planning) {
      // A menu can consume the release after Done opens it. Retire only our stale presses before re-equipping.
      for (const press of window.WorldActionInputClaims?.snapshot?.().pressed || []) {
        if (press.ownerId === 'farmwork-planning') window.WorldActionInputClaims.dispatch(press.actionId, 'cancel');
      }
      window.WorldActionInputClaims?.setClaims?.('farmwork-planning', [
        { actionId: 'action1', label: planningMode === 'block' ? 'Add tile to seed block' : 'Add tile', priority: 200, onPress: () => applyAimedTile(true) },
        { actionId: 'action2', label: planningMode === 'block' ? 'Remove tile from seed block' : 'Remove tile', priority: 200, onPress: () => applyAimedTile(false) },
        { actionId: 'action3', label: 'Done planning', priority: 200, onPress: () => setPlanning(false) },
      ]);
      context()?.resumeMouseCameraAfterUi?.();
      context()?.showToast?.((planningMode === 'block' ? 'Seed block selection (inside field only)' : 'Plot selection') + ': Action 1 adds · Action 2 removes · Action 3 finishes.', true);
    } else if (open) {
      context()?.suspendMouseCameraForUi?.();
      render();
      const selector = planningMode === 'block' ? '[data-fwblockplan]' : '[data-fwplan]';
      pane()?.querySelector(selector)?.focus?.({ preventScroll: true });
    }
    context()?.refreshActions?.();
    lastVisualAt = -Infinity;
    return planning;
  }
  function editTile(c, r, present, deferSave = false) {
    const p = plot(), ctx = context();
    if (!open || !canOpen() || !p) return false;
    if (planningMode === 'block') {
      const b = block();
      if (!b || !p.tiles.some(t => t[0] === c && t[1] === r)) {
        ctx?.showToast?.('A seed block may contain only tiles already belonging to this field.', false);
        return false;
      }
      const changed = !!manager()?.setSeedBlockTile?.(p.id, b.id, c, r, present, { deferSave });
      if (changed) lastVisualAt = -Infinity;
      return changed;
    }
    if (present && (!ctx?.canDesignate?.(c, r, p.kind) || !fits(p, c, r))) {
      ctx?.showToast?.(!fits(p, c, r) ? 'A plot can be at most 7 tiles wide and 7 tiles deep.' : 'Choose an unobstructed farm tile.', false);
      return false;
    }
    const changed = !!manager()?.setFamilyTile?.(p.id, c, r, present, { deferSave });
    if (changed) lastVisualAt = -Infinity;
    return changed;
  }
  function canAddTile(c, r) {
    const p = plot();
    return !!p && (planningMode === 'block' ? !!block() && p.tiles.some(t => t[0] === c && t[1] === r) : !!context()?.canDesignate?.(c, r, p.kind) && fits(p, c, r));
  }
  function applyAimedTile(present) {
    if (!planning) return false;
    if (!canOpen()) { close(); return false; }
    const t = context()?.aimTile?.();
    const changed = !!t && editTile(t.col, t.row, present);
    if (changed) render();
    return changed;
  }
  function actionButtons() {
    if (!planning) return null;
    return [
      { icon: '+', label: planningMode === 'block' ? 'Add to seed block' : 'Add tile', action: 'farmwork_add', inputAction: 'action1', style: 'primary', allowed: true },
      { icon: '−', label: planningMode === 'block' ? 'Remove from seed block' : 'Remove tile', action: 'farmwork_remove', inputAction: 'action2', style: 'secondary', allowed: true },
      { icon: '✓', label: 'Done planning', action: 'farmwork_done', inputAction: 'action3', style: 'secondary', allowed: true },
    ];
  }
  function enter() {
    if (!canOpen()) return false;
    window.FurniturePlacer?.close?.(); // Disarm any pending furniture placement, even if its picker was already dismissed.
    const first = manager()?.plots?.()[0];
    if (!plot() && first) manager()?.selectFamilyPlot?.(first.id);
    window.PerceptionMode?.setActive?.(false);
    open = true;
    setPlanning(false);
    return true;
  }
  function endDrag() {
    if (!drag) return;
    if (drag.changed) manager()?.commitFamilyEdits?.(); // Batched brush drag writes one layout snapshot, not one save per pointermove.
    drag = null;
    if (open) render();
  }
  function close() {
    if (!open) return true;
    confirmDeleteId = null;
    endDrag();
    open = false;
    setPlanning(false);
    clearVisuals();
    if (pane()) pane().style.display = 'none';
    context()?.resumeMouseCameraAfterUi?.();
    return true;
  }
  function toggle() { return open ? close() : enter(); }
  function changePlot(id) {
    endDrag();
    confirmDeleteId = null;
    manager()?.selectFamilyPlot?.(id);
    selectedBlockId = null;
    planningMode = 'plot';
    lastVisualAt = -Infinity;
    render();
  }
  function create(kind) {
    if (!canOpen()) { close(); return; }
    const id = manager()?.createFamilyPlot?.(kind);
    if (id) changePlot(id);
  }
  function createBlock() {
    const p = plot();
    if (!p || p.kind !== 'till') return;
    const id = manager()?.createSeedBlock?.(p.id);
    if (id) { selectedBlockId = id; lastVisualAt = -Infinity; render(); }
  }
  function chooseBlock(id) {
    selectedBlockId = id;
    lastVisualAt = -Infinity;
    render();
  }
  function deleteBlock() {
    const p = plot(), b = block();
    if (!p || !b) return;
    if (manager()?.deleteSeedBlock?.(p.id, b.id)) {
      selectedBlockId = p.seedBlocks?.[0]?.id || null;
      lastVisualAt = -Infinity; render();
    }
  }
  function editBlockPriority(action, index, value) {
    const p = plot(), b = block();
    if (!p || !b) return;
    const seeds = [...b.seeds]; // Priority 1 is the first seed available in world-scoped Farm Storage.
    if (action === 'append') {
      const available = manager()?.cropOptions?.().find(c => !seeds.includes(c.value));
      if (!available) return;
      seeds.push(available.value);
    } else if (action === 'remove') seeds.splice(index, 1);
    else if (action === 'set') seeds[index] = value;
    else if (action === 'up' && index > 0) [seeds[index - 1], seeds[index]] = [seeds[index], seeds[index - 1]];
    else if (action === 'down' && index < seeds.length - 1) [seeds[index], seeds[index + 1]] = [seeds[index + 1], seeds[index]];
    else return;
    if (!manager()?.updateSeedBlock?.(p.id, b.id, { seeds })) context()?.showToast?.('Each seed can appear only once in a priority list.', false);
    render();
  }
  function removeCurrent() {
    const current = plot();
    if (!current) return;
    if (confirmDeleteId !== current.id) {
      confirmDeleteId = current.id; // First A press arms deletion; second A press confirms it.
      render();
      pane()?.querySelector('[data-fwdelete]')?.focus({ preventScroll: true });
      return;
    }
    confirmDeleteId = null;
    manager()?.deleteFamilyPlot?.(current.id);
    render();
  }
  function updateField(field, value) {
    const p = plot();
    if (!p) return;
    const patch = {};
    if (field === 'crop' || field === 'label') patch[field] = value;
    if (field === 'from' || field === 'to') {
      const hours = [...p.hours];
      hours[field === 'from' ? 0 : 1] = Number(value);
      patch.hours = hours;
    }
    if (field.startsWith('worker')) {
      const workers = [];
      pane()?.querySelectorAll('[data-fwfield^="worker"]')?.forEach(select => {
        if (select.value && !workers.includes(select.value)) workers.push(select.value);
      });
      patch.workers = workers;
    }
    if (!manager()?.updateFamilyPlot?.(p.id, patch)) {
      context()?.showToast?.('That farmwork setting is not valid.', false);
    }
    render();
  }
  function toggleTile(c, r) {
    const p = plot();
    if (!p) return false;
    const owned = planningMode === 'block' ? block()?.tiles : p.tiles;
    const changed = editTile(c, r, !owned?.some(t => t[0] === c && t[1] === r));
    if (changed) render();
    return changed;
  }
  function startWorldPointer(pointerId, x, y, action = 'action1') {
    if (!open) return false;
    endDrag();
    // Settings mode also owns viewport clicks so they cannot perform an unrelated action.
    if (!planning) { drag = { pointerId, plotId: null, adding: false, changed: false }; return true; }
    const p = plot();
    drag = { pointerId, plotId: p?.id, blockId: planningMode === 'block' ? selectedBlockId : null, adding: action !== 'action2', changed: false };
    dragTile(pointerId, x, y);
    return true;
  }
  function dragTile(pointerId, x, y) {
    if (!drag || drag.pointerId !== pointerId) return false;
    const ctx = context(), t = ctx?.screenTile?.(x, y);
    const current = plot(); // Ownership for the entire stroke is locked at pointerdown.
    if (planning && t && current?.id === drag.plotId && (planningMode !== 'block' || selectedBlockId === drag.blockId)) {
      if (editTile(t.col, t.row, drag.adding, true)) drag.changed = true;
    }
    return true;
  }
  function endWorldPointer(pointerId) { if (!drag || (pointerId != null && drag.pointerId !== pointerId)) return false; endDrag(); return true; }

  function render() {
    if (!open) return;
    if (!canOpen()) { close(); return; }
    const el = pane(), ctx = context(), farmPlots = manager()?.plots?.() || [], chosen = plot();
    if (!el || !ctx) return;
    const people = manager()?.family?.() || []; // Same spouse/child eligibility list as the developer plot editor.
    const cropOptions = manager()?.cropOptions?.() || [];
    const view = el.querySelector('#farmworkContents');
    if (!view) return;
    let html = `<p class="fw-note">White grid: farm tiles. Cyan: selected plot. Violet: other plots and assignable vats. Choose a plot to set workers, or equip its planning tool.</p>
      <div class="fw-actions"><button data-fwnew="till" ${!farmPlots.length ? 'data-ctrl-default' : ''}>🌱 New Field</button><button data-fwnew="dig">🕳️ New Trench</button></div>
      <div class="fw-plots" data-ctrl-transparent>${farmPlots.map(p => `<div class="fw-plot-row"><button data-fwplot="${esc(p.id)}" ${p.id === chosen?.id ? 'data-ctrl-default' : ''} aria-pressed="${p.id === chosen?.id}">${esc(p.label)} (${p.tiles.length})</button><button data-fwplan="${esc(p.id)}" aria-label="Add/remove tiles for ${esc(p.label)}" aria-pressed="${planning && p.id === chosen?.id}">Add/remove tiles</button></div>`).join('')}</div>`;
    if (chosen) {
      html += `<div class="fw-settings" data-ctrl-transparent>
        <label>Plot name<input name="fw-label" data-fwfield="label" value="${esc(chosen.label)}" maxlength="48"></label>
        ${chosen.kind === 'till' ? `<label>Default seed for unassigned field tiles<select name="fw-crop" data-fwfield="crop"><option value="">No seeding</option>${cropOptions.map(c => `<option value="${esc(c.value)}" ${chosen.crop === c.value ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>` : ''}
        ${[0, 1, 2].map(i => `<label>${i ? 'Backup ' + i : 'Primary worker'}<select name="fw-worker${i}" data-fwfield="worker${i}"><option value="">None</option>${people.map(person => `<option value="${esc(person.id)}" ${chosen.workers[i] === person.id ? 'selected' : ''}>${esc(person.name)}</option>`).join('')}</select></label>`).join('')}
        <div class="fw-hours"><label>From<select name="fw-from" data-fwfield="from">${hourOptions(chosen.hours[0])}</select></label><label>Until<select name="fw-to" data-fwfield="to">${hourOptions(chosen.hours[1])}</select></label></div>
      </div>
      ${chosen.kind === 'till' ? seedBlocksHTML(chosen, cropOptions) : ''}
      ${footprintHTML(chosen)}
      <p class="fw-note">Plots start empty. Add/remove tiles equips the planning tool: Action 1 adds, Action 2 removes. Each plot fits within 7 × 7 tiles. Workers use Farm Storage seeds and follow their schedules.</p>
      <button class="fw-delete" data-fwdelete>${confirmDeleteId === chosen.id ? 'Confirm Remove (keeps soil/crops)' : 'Stop Assigning This Plot'}</button>`;
    }
    view.innerHTML = html;
    if (visualPlots !== farmPlots || visualTiles.length !== farmPlots.length || visualTiles.some((tiles, i) => tiles !== farmPlots[i].tiles)) lastVisualAt = -Infinity;
    view.querySelectorAll('[data-fwnew]').forEach(button => button.addEventListener('click', () => create(button.dataset.fwnew)));
    view.querySelectorAll('[data-fwplot]').forEach(button => button.addEventListener('click', () => changePlot(button.dataset.fwplot)));
    view.querySelectorAll('[data-fwfield]').forEach(select => select.addEventListener('change', () => updateField(select.dataset.fwfield, select.value)));
    view.querySelectorAll('[data-fwplan]').forEach(button => button.addEventListener('click', () => {
      changePlot(button.dataset.fwplan); setPlanning(true);
    }));
    view.querySelector('[data-fwblocknew]')?.addEventListener('click', createBlock);
    view.querySelectorAll('[data-fwblock]').forEach(button => button.addEventListener('click', () => chooseBlock(button.dataset.fwblock)));
    view.querySelector('[data-fwblocklabel]')?.addEventListener('change', event => {
      const p = plot(), b = block();
      if (p && b) manager()?.updateSeedBlock?.(p.id, b.id, { label: event.target.value });
      render();
    });
    view.querySelector('[data-fwblockplan]')?.addEventListener('click', () => setPlanning(true, 'block'));
    view.querySelector('[data-fwblockdel]')?.addEventListener('click', deleteBlock);
    view.querySelectorAll('[data-fwseed]').forEach(select => select.addEventListener('change', () => editBlockPriority('set', Number(select.dataset.fwseed), select.value)));
    view.querySelectorAll('[data-fwseedaction]').forEach(button => button.addEventListener('click', () => editBlockPriority(button.dataset.fwseedaction, Number(button.dataset.fwseedindex))));
    view.querySelector('[data-fwseedappend]')?.addEventListener('click', () => editBlockPriority('append'));
    view.querySelector('[data-fwdelete]')?.addEventListener('click', removeCurrent);
  }
  function seedBlocksHTML(chosen, cropOptions) {
    const blocks = chosen.seedBlocks || []; // Controller-visible rows give each seed block a separate editable subarea.
    const active = blocks.find(b => b.id === selectedBlockId);
    return `<section class="fw-settings" data-ctrl-transparent aria-label="Seed blocks">
      <strong>Seed blocks (priority planting)</strong>
      <p class="fw-note">Divide your field into blocks, then rank seeds. Workers take the first available from Farm Storage; if none are in stock, they leave that block unseeded.</p>
      <div class="fw-plot-row"><button data-fwblocknew>Add seed block</button></div>
      ${blocks.map(b => `<div class="fw-plot-row"><button data-fwblock="${esc(b.id)}" aria-pressed="${b.id === selectedBlockId}">${esc(b.label)} (${b.tiles.length} tiles)</button></div>`).join('')}
      ${active ? `<div class="fw-settings" data-ctrl-transparent>
        <strong>${esc(active.label)} · ${active.tiles.length} tiles</strong>
        <label>Block name<input data-fwblocklabel maxlength="48" value="${esc(active.label)}"></label>
        <button data-fwblockplan>Choose tiles for this seed block</button>
        <p class="fw-note">Only tiles already assigned to this field can join. Action 1 adds, Action 2 removes.</p>
        ${active.seeds.map((seed, index) => `<div class="fw-plot-row" data-ctrl-transparent>
          <label>Priority ${index + 1}<select data-fwseed="${index}" aria-label="Seed priority ${index + 1}">${cropOptions.map(c => `<option value="${esc(c.value)}" ${seed === c.value ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>
          <button data-fwseedaction="up" data-fwseedindex="${index}" aria-label="Raise priority ${index + 1}" ${index ? '' : 'disabled'}>↑</button>
          <button data-fwseedaction="down" data-fwseedindex="${index}" aria-label="Lower priority ${index + 1}" ${index < active.seeds.length - 1 ? '' : 'disabled'}>↓</button>
          <button data-fwseedaction="remove" data-fwseedindex="${index}" aria-label="Remove priority ${index + 1}">×</button>
        </div>`).join('')}
        <button data-fwseedappend ${active.seeds.length >= cropOptions.length ? 'disabled' : ''}>Add seed priority</button>
        <button data-fwblockdel>Delete seed block (keeps field tiles)</button>
      </div>` : ''}
    </section>`;
  }
  function footprintHTML(chosen) {
    const b = bounds(chosen);
    if (!b) return '<p class="fw-empty">No tiles yet — equip Add/remove tiles to draw this plot on the farm.</p>';
    const width = b.maxC - b.c + 1, height = b.maxR - b.r + 1;
    // Explicit CSS grid positions preserve empty holes without rendering any excluded tile containers.
    const active = block(); // Mark currently selected seed-block tiles without adding any excluded grid containers.
    return `<div class="fw-grid" data-fwgrid role="img" aria-label="${esc(chosen.label)} footprint, ${chosen.tiles.length} tiles, ${width} by ${height}" style="grid-template-columns:repeat(${width},32px);grid-template-rows:repeat(${height},32px)">${chosen.tiles.map(([c, r]) =>
      `<span class="fw-footprint-tile" data-fwtile="${c},${r}" style="grid-column:${c - b.c + 1};grid-row:${r - b.r + 1};${active?.tiles.some(t => t[0] === c && t[1] === r) ? 'box-shadow:inset 0 0 0 3px #ffe38a;' : ''}" title="Column ${c + 1}, row ${r + 1}"></span>`).join('')}</div>`;
  }
  function clearVisuals() {
    if (visualGroup) {
      visualGroup.parent?.remove(visualGroup);
      visualGroup.traverse(node => { node.geometry?.dispose(); node.material?.dispose(); });
    }
    visualGroup = visualScene = null;
    highlightRoots = [];
    visualPlots = null; visualTiles = [];
  }
  function updateVisuals(now) {
    if (!open) return;
    if (!canOpen()) { close(); return; }
    const ctx = context(), T = window.THREE, scene = ctx?.scene;
    const farmPlots = manager()?.plots?.() || [];
    const changed = visualPlots !== farmPlots || visualTiles.length !== farmPlots.length || visualTiles.some((tiles, i) => tiles !== farmPlots[i].tiles);
    if (!T || !scene) return;
    const sample = (x, z) => (window.FarmSurfaceSample?.farmSurfaceYAtWorld?.(Math.min(ctx.cols - 0.001, Math.max(0.001, x)), Math.min(ctx.rows - 0.001, Math.max(0.001, z))) || 0) + 0.035;
    if (scene === visualScene && !changed && lastVisualAt !== -Infinity) {
      if (now - lastVisualAt >= 350) {
        // Ground work can change soil/trench height. Update existing buffers, never rebuild GPU resources on a timer.
        visualGroup.traverse(node => {
          const attr = node.geometry?.attributes?.position;
          if (!attr) return;
          for (let i = 0; i < attr.count; i++) attr.setY(i, sample(attr.getX(i) + node.position.x, attr.getZ(i) + node.position.z));
          attr.needsUpdate = true;
          node.geometry.computeBoundingSphere();
        });
        lastVisualAt = now;
      }
      return;
    }
    clearVisuals();
    lastVisualAt = now;
    visualScene = scene;
    visualPlots = farmPlots; visualTiles = farmPlots.map(p => p.tiles);
    visualGroup = new T.Group();
    visualGroup.name = 'farmwork-ground-planning';
    scene.add(visualGroup);
    const positions = [];
    const vertex = (x, z) => positions.push(x, sample(x, z), z);
    // A fine ground-following mesh carries a white line core plus a soft halo.
    // This intentionally uses an untextured shader, rather than the authored PNG-plane pipeline.
    for (let r = 0; r < ctx.rows; r += 0.5) for (let c = 0; c < ctx.cols; c += 0.5) {
      vertex(c, r); vertex(c, r + 0.5); vertex(c + 0.5, r);
      vertex(c + 0.5, r); vertex(c, r + 0.5); vertex(c + 0.5, r + 0.5);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    const grid = new T.Mesh(geo, new T.ShaderMaterial({
      vertexShader: 'varying vec2 vGround; void main(){ vGround = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec2 vGround; void main(){
        vec2 edge = abs(fract(vGround + 0.5) - 0.5);
        float dist = min(edge.x, edge.y);
        float core = 1.0 - smoothstep(0.008, 0.022, dist);
        float halo = exp(-dist * 45.0) * 0.28;
        float alpha = max(core * 0.85, halo);
        if(alpha < 0.01) discard;
        gl_FragColor = vec4(1.0,1.0,1.0,alpha);
      }`,
      transparent: true, depthWrite: false, side: T.DoubleSide, toneMapped: false,
    }));
    grid.name = 'farmwork-white-grid';
    grid.renderOrder = 2;
    visualGroup.add(grid);
    for (const p of manager()?.plots?.() || []) {
      const root = new T.Group(); root.name = `farmwork-plot-${p.id}`;
      visualGroup.add(root);
      for (const [c, r] of p.tiles) {
        const geometry = new T.PlaneGeometry(0.92, 0.92, 2, 2);
        geometry.rotateX(-Math.PI / 2);
        const attr = geometry.attributes.position;
        for (let i = 0; i < attr.count; i++) attr.setY(i, sample(c + 0.5 + attr.getX(i), r + 0.5 + attr.getZ(i)));
        const inBlock = p.id === plot()?.id && block()?.tiles.some(t => t[0] === c && t[1] === r);
        const tile = new T.Mesh(geometry, new T.MeshBasicMaterial({ color: inBlock ? 0xffe38a : p.id === plot()?.id ? 0x35dcff : 0xb58aff, transparent: true, opacity: inBlock ? 0.32 : 0.16, depthWrite: false, side: T.DoubleSide, toneMapped: false }));
        tile.position.set(c + 0.5, 0.005, r + 0.5);
        root.add(tile);
      }
      if (p.tiles.length) highlightRoots.push({ root, category: p.id === plot()?.id ? 'farmSelected' : 'farmAssignable' });
    }
  }
  function glowTargets() {
    const hasChild = window.RomanceFamily?.snapshot?.()?.children?.some(child => child.phase === 'child');
    const vats = hasChild ? (window.DewVats?.listSqueezingVats?.() || []).filter(vat => {
      const worker = window.DewVats?.assignedWorkerForVat?.(vat.id);
      return !worker || worker.external; // Occupied livestock vats cannot receive a family member.
    }) : [];
    return [...highlightRoots, ...vats.map(vat => ({ root: vat.promptRoot || vat.root || vat.group || vat.mesh, category: 'farmAssignable' }))];
  }
  function hourOptions(selected) {
    return Array.from({ length: 49 }, (_, i) => {
      const hour = i / 2; // Keep the existing half-hour schedule precision when editing old family plots.
      return `<option value="${hour}" ${Number(selected) === hour ? 'selected' : ''}>${String(Math.floor(hour)).padStart(2, '0')}:${i % 2 ? '30' : '00'}</option>`;
    }).join('');
  }
  window.FarmworkUI = { canOpen, open: enter, close, toggle, isOpen: () => open, isPanelOpen: () => open && !planning, isPlanning: () => planning,
    render, create, changePlot, toggleTile, setPlanning, applyAimedTile, canAddTile, actionButtons, updateVisuals, glowTargets,
    startWorldPointer, dragTile, endWorldPointer, createBlock, chooseBlock, editBlockPriority, _test: { bounds, fits, footprintHTML, seedBlocksHTML, selectedSeedBlock: block } };
})();
