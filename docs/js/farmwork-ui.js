// Ordinary gameplay Farmwork manager. Uses FarmPlotEditor records + FarmEditor's existing grid access,
// but never enables the dev terrain painter. The 7x7 tile window is fully controller navigable.
(() => {
  'use strict';
  if (window.FarmworkUI) return;

  const SIZE = 7; // Tile window width/height; keeps gamepad navigation and mobile layout manageable.
  let open = false; // Used by the utility wheel, controller panel and farm-world pointer bridge.
  let originC = 0, originR = 0; // Top-left tile of the scrollable designation grid.
  let drag = null; // World pointer drag: { pointerId, plotId, adding, changed } to commit exactly once.
  let confirmDeleteId = null; // Two-press remove guard usable with controller A, without a native browser confirm modal.
  const pane = () => document.getElementById('farmworkPanel'); // Existing markup registers with ControllerUiNav via data-ctrl-panel.
  const manager = () => window.FarmPlotEditor; // All edits route through the single persisted family-plot owner.
  const context = () => window.FarmEditor?.farmworkTileAccess?.(); // Farm bounds, house collision and world-pointer projection remain in FarmEditor.
  const esc = value => String(value ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const clamp = (v, max) => Math.max(0, Math.min(Math.max(0, max - SIZE), v)); // Prevent panning the tile window off-map.
  const plot = () => manager()?.activeFamilyPlot?.(); // Currently selected field or trench, shared with the developer editor.
  const canOpen = () => !!(window.RomanceSystem?.getSpouse?.()?.npcId && context()?.editable); // Only an existing spouse, on the player's farm.

  function focusTile(c, r) {
    pane()?.querySelectorAll('[data-fwtile]')?.forEach(button => {
      if (button.dataset.fwtile === `${c},${r}`) button.focus({ preventScroll: true }); // Retain A-button focus after the grid refresh.
    });
  }
  function setOrigin(c, r) {
    const ctx = context();
    if (!ctx) return;
    originC = clamp(Math.floor(c), ctx.cols);
    originR = clamp(Math.floor(r), ctx.rows);
  }
  function center(c, r) { setOrigin(c - Math.floor(SIZE / 2), r - Math.floor(SIZE / 2)); }
  function enter() {
    if (!canOpen()) return false;
    if (window.FurniturePlacer?.isOpen?.()) window.FurniturePlacer.close(); // Only one normal-play editing panel owns input at a time.
    const first = manager()?.plots?.()[0];
    if (!plot() && first) manager()?.selectFamilyPlot?.(first.id);
    const current = plot();
    const middle = context()?.centerTile?.();
    const anchor = current?.tiles?.[0] || (middle ? [middle.col, middle.row] : [Math.floor(context().cols / 2), Math.floor(context().rows / 2)]);
    center(anchor[0], anchor[1]);
    open = true;
    if (pane()) pane().style.display = 'flex';
    context()?.suspendMouseCameraForUi?.();
    render();
    return true;
  }
  function endDrag() {
    if (!drag) return;
    if (drag.changed) manager()?.commitFamilyEdits?.(); // Batched brush drag writes one layout snapshot, not one save per pointermove.
    drag = null;
    if (open) render();
  }
  function close() {
    confirmDeleteId = null;
    endDrag();
    open = false;
    if (pane()) pane().style.display = 'none';
    context()?.resumeMouseCameraAfterUi?.();
    return true;
  }
  function toggle() { return open ? close() : enter(); }
  function changePlot(id) {
    confirmDeleteId = null;
    manager()?.selectFamilyPlot?.(id);
    const first = plot()?.tiles?.[0];
    if (first) center(first[0], first[1]);
    render();
  }
  function create(kind) {
    if (!canOpen()) { close(); return; }
    const id = manager()?.createFamilyPlot?.(kind);
    if (id) changePlot(id);
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
    const p = plot(), ctx = context();
    if (!canOpen() || !p || !ctx?.canDesignate?.(c, r, p.kind)) return false;
    const present = !p.tiles.some(t => t[0] === c && t[1] === r);
    if (!manager()?.setFamilyTile?.(p.id, c, r, present)) return false;
    render(); focusTile(c, r);
    return true;
  }
  function startWorldPointer(pointerId, x, y) {
    if (!open) return false;
    endDrag();
    const p = plot(), ctx = context();
    const t = ctx?.screenTile?.(x, y);
    if (!p || !t || !ctx.canDesignate(t.col, t.row, p.kind)) {
      drag = { pointerId, plotId: null, adding: false, changed: false }; // Own the matching release too; an invalid touch must not become a world Action 1.
      ctx?.showToast?.('Choose a plot and an unobstructed farm tile.', false);
      return true; // Farmwork mode owns world clicks even when invalid; never perform an unrelated game action.
    }
    const adding = !p.tiles.some(v => v[0] === t.col && v[1] === t.row);
    drag = { pointerId, plotId: p.id, adding, changed: false }; // First tile selects add vs erase for the whole touch/mouse stroke.
    dragTile(pointerId, x, y);
    return true;
  }
  function dragTile(pointerId, x, y) {
    if (!drag || drag.pointerId !== pointerId) return false;
    const ctx = context(), t = ctx?.screenTile?.(x, y);
    if (t && ctx.canDesignate(t.col, t.row, plot()?.kind) && plot()?.id === drag.plotId) {
      if (manager()?.setFamilyTile?.(drag.plotId, t.col, t.row, drag.adding, { deferSave: true })) drag.changed = true;
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
    const selection = el.querySelector('[data-fwgrid]'); // Preserve the last controller tile focus across redraws.
    const priorFocus = document.activeElement?.dataset?.fwtile || (selection?.contains?.(document.activeElement) ? document.activeElement?.dataset?.fwtile : '');
    const view = el.querySelector('#farmworkContents');
    if (!view) return;
    let html = `<p class="fw-note">Designate tiles for your family to work; this does not create crops or soil for free. A = select tile, B = close.</p>
      <div class="fw-actions"><button data-fwnew="till" ${!farmPlots.length ? 'data-ctrl-default' : ''}>🌱 New Field</button><button data-fwnew="dig">🕳️ New Trench</button></div>
      <div class="fw-plots" data-ctrl-transparent>${farmPlots.map(p => `<button data-fwplot="${esc(p.id)}" aria-pressed="${p.id === chosen?.id}">${esc(p.label)} (${p.tiles.length})</button>`).join('')}</div>`;
    if (chosen) {
      html += `<div class="fw-settings" data-ctrl-transparent>
        <label>Plot name<input data-fwfield="label" value="${esc(chosen.label)}" maxlength="48"></label>
        ${chosen.kind === 'till' ? `<label>Seed crop<select data-fwfield="crop"><option value="">No seeding</option>${cropOptions.map(c => `<option value="${esc(c.value)}" ${chosen.crop === c.value ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>` : ''}
        ${[0, 1, 2].map(i => `<label>${i ? 'Backup ' + i : 'Primary worker'}<select data-fwfield="worker${i}"><option value="">None</option>${people.map(person => `<option value="${esc(person.id)}" ${chosen.workers[i] === person.id ? 'selected' : ''}>${esc(person.name)}</option>`).join('')}</select></label>`).join('')}
        <div class="fw-hours"><label>From<select data-fwfield="from">${hourOptions(chosen.hours[0])}</select></label><label>Until<select data-fwfield="to">${hourOptions(chosen.hours[1])}</select></label></div>
      </div>
      <div class="fw-nav"><button data-fwpage="left" aria-label="Map left 7 tiles">◀</button><button data-fwpage="up" aria-label="Map up 7 tiles">▲</button><span>Tiles C${originC + 1}–${Math.min(ctx.cols, originC + SIZE)} / R${originR + 1}–${Math.min(ctx.rows, originR + SIZE)}</span><button data-fwpage="down" aria-label="Map down 7 tiles">▼</button><button data-fwpage="right" aria-label="Map right 7 tiles">▶</button></div>
      <div class="fw-grid" data-fwgrid data-ctrl-transparent>${Array.from({ length: SIZE * SIZE }, (_, i) => {
        const c = originC + (i % SIZE), r = originR + Math.floor(i / SIZE);
        if (c >= ctx.cols || r >= ctx.rows) return '<span></span>';
        const usable = ctx.canDesignate(c, r, chosen.kind);
        const selected = chosen.tiles.some(t => t[0] === c && t[1] === r);
        const other = farmPlots.some(p => p.id !== chosen.id && p.tiles.some(t => t[0] === c && t[1] === r));
        return `<button data-fwtile="${c},${r}" aria-label="Tile ${c + 1}, ${r + 1}${selected ? ', assigned' : other ? ', other plot' : ''}" aria-pressed="${selected}" ${usable ? '' : 'disabled'} title="Column ${c + 1}, row ${r + 1}">${selected ? '✓' : other ? '•' : '·'}</button>`;
      }).join('')}</div>
      <p class="fw-note">Controller: stick or D-pad moves between tiles; A adds/removes them. Page arrows move the map. Touch/mouse can also paint directly on the farm behind this panel. Workers use Farm Storage seeds and follow their schedules.</p>
      <button class="fw-delete" data-fwdelete>${confirmDeleteId === chosen.id ? 'Confirm Remove (keeps soil/crops)' : 'Stop Assigning This Plot'}</button>`;
    }
    view.innerHTML = html;
    view.querySelectorAll('[data-fwnew]').forEach(button => button.addEventListener('click', () => create(button.dataset.fwnew)));
    view.querySelectorAll('[data-fwplot]').forEach(button => button.addEventListener('click', () => changePlot(button.dataset.fwplot)));
    view.querySelectorAll('[data-fwfield]').forEach(select => select.addEventListener('change', () => updateField(select.dataset.fwfield, select.value)));
    view.querySelectorAll('[data-fwpage]').forEach(button => button.addEventListener('click', () => {
      const side = button.dataset.fwpage;
      setOrigin(originC + (side === 'left' ? -SIZE : side === 'right' ? SIZE : 0), originR + (side === 'up' ? -SIZE : side === 'down' ? SIZE : 0));
      render();
    }));
    view.querySelectorAll('[data-fwtile]').forEach(button => button.addEventListener('click', () => {
      const [c, r] = button.dataset.fwtile.split(',').map(Number);
      toggleTile(c, r);
    }));
    view.querySelector('[data-fwdelete]')?.addEventListener('click', removeCurrent);
    if (priorFocus) {
      const target = Array.from(view.querySelectorAll('[data-fwtile]')).find(b => b.dataset.fwtile === priorFocus);
      target?.focus({ preventScroll: true });
    }
  }
  function hourOptions(selected) {
    return Array.from({ length: 25 }, (_, i) => `<option value="${i}" ${Number(selected) === i ? 'selected' : ''}>${String(i).padStart(2, '0')}:00</option>`).join('');
  }
  window.FarmworkUI = { canOpen, open: enter, close, toggle, isOpen: () => open, render, create, changePlot, toggleTile, startWorldPointer, dragTile, endWorldPointer, _test: { setOrigin, getOrigin: () => [originC, originR] } };
})();
