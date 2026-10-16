(() => {
  'use strict';

  // Farm Layout editor. Reuses the shared House/Barn layout modal
  // (FarmPanel.openLayoutEditor, docs/js/farm-panel-core.js) with an adapter
  // whose pieces are whole farm structures: the assembled house, each
  // connected barn (its rooms plus attached incubators), every production
  // building and the shipping box. Pieces drag-move in the live top-down
  // view; production buildings also turn in quarter steps. Every change goes
  // through the structure's own authority (HousePieces.moveHouse,
  // FarmBuildings.moveGroup, FarmProduction.move/rotate,
  // FarmCrates.moveShippingBox), so saves, meshes and occupancy stay coherent.
  // Individual house rooms and barn incubators stay in their own editors.

  let deps = null; // getHousePieces, getFarmBuildings, hasFarmPermission, showToast, esc, COLS, ROWS (game.js).

  function init(injectedDeps) { deps = injectedDeps; }

  const canAlter = () => deps?.hasFarmPermission?.('alterFarm') === true;
  const productionDefs = () => window.FARM_SPECIALIZATIONS_CONFIG?.buildings || {};

  function boundsOf(rects) {
    let minC = Infinity, minR = Infinity, maxC = -Infinity, maxR = -Infinity;
    for (const rect of rects) {
      minC = Math.min(minC, rect.col); minR = Math.min(minR, rect.row);
      maxC = Math.max(maxC, rect.col + rect.w); maxR = Math.max(maxR, rect.row + rect.h);
    }
    return { col: minC, row: minR, w: maxC - minC, h: maxR - minR };
  }

  function housePiece() {
    const rooms = deps.getHousePieces() || [];
    if (!rooms.length) return null;
    return { id: 'farm_house', kind: 'house', ...boundsOf(rooms), rooms: rooms.length, foundation: rooms.some(room => room.stage === 'foundation') };
  }

  function barnPieces() {
    const seen = new Set(), out = []; // A connected barn appears once, however many rooms it has.
    for (const barn of deps.getFarmBuildings() || []) {
      if (barn.kind !== 'barn' || seen.has(barn.id)) continue;
      const rooms = window.FarmBuildings?.connectedBarnRooms?.(barn.id) || [barn];
      rooms.forEach(room => seen.add(room.id));
      const parts = window.BarnIncubator?.createBarnLayoutAdapter?.(barn.id)?.getPieces?.() || rooms; // Rooms plus attached incubators, in farm coordinates.
      const rects = parts.map(part => ({ id: part.id, col: part.col, row: part.row, w: part.w, h: part.h }));
      out.push({ id: 'farm_barn_' + barn.id, kind: 'barn', anchorId: barn.id, roomIds: rooms.map(room => room.id), rects, ...boundsOf(rects),
        rooms: rooms.length, foundation: rooms.some(room => room.stage === 'foundation') });
    }
    return out;
  }

  function productionPieces() {
    const api = window.FarmProduction;
    return (api?.entries?.() || []).map(entry => ({ id: entry.id, kind: 'production', key: entry.key, rot: entry.rot || 0,
      col: entry.col, row: entry.row, ...api.footprint(entry) }));
  }

  function shippingPiece() {
    const box = window.FarmCrates?.getShippingBox?.();
    return box ? { id: box.id, kind: 'shipping', col: box.col, row: box.row, w: box.w, h: box.h, label: box.label } : null;
  }

  function label(piece) {
    if (piece.kind === 'house') return 'House' + (piece.rooms > 1 ? ` (${piece.rooms} rooms)` : '') + (piece.foundation ? ' · unbuilt rooms' : '');
    if (piece.kind === 'barn') {
      const room = deps.getFarmBuildings().find(entry => entry.id === piece.anchorId);
      const name = piece.rooms > 1 ? `Barn (${piece.rooms} rooms)` : (room ? window.FarmBuildings?.label?.(room) : null) || 'Barn';
      return name + (piece.foundation ? ' (foundation)' : '');
    }
    if (piece.kind === 'production') return productionDefs()[piece.key]?.label || 'Building';
    return String(piece.label || 'Shipping Box').replace(/^\S+\s/, '');
  }

  function icon(piece) {
    if (piece.kind === 'house') return '🏠';
    if (piece.kind === 'barn') return '🏚';
    if (piece.kind === 'production') return productionDefs()[piece.key]?.icon || '🏗';
    return '📦';
  }

  function canMove(piece, col, row) {
    if (!canAlter() || !Number.isInteger(col) || !Number.isInteger(row)) return false;
    if (piece.kind === 'house') return null; // HousePieces.moveHouse validates every room on release.
    if (piece.kind === 'barn') {
      const dCol = col - piece.col, dRow = row - piece.row;
      const travelling = new Set(piece.rects.map(rect => rect.id)); // The barn never collides with its own current tiles.
      return piece.rects.every(rect => window.FarmBuildings.canPlaceAt(rect.col + dCol, rect.row + dRow, rect.w, rect.h, travelling));
    }
    if (piece.kind === 'production') return window.FarmProduction.canPlace(piece.key, col, row, piece.id, piece.rot);
    return window.FarmBuildings.canPlaceAt(col, row, piece.w, piece.h, piece.id);
  }

  function move(piece, col, row) {
    if (!canAlter()) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can rearrange the farm." };
    if (col === piece.col && row === piece.row) return { ok: false, message: 'Already there.' };
    if (piece.kind === 'house') {
      const starter = deps.getHousePieces().find(room => room.id === 'house_starter');
      return starter ? window.HousePieces.moveHouse(starter.col + col - piece.col, starter.row + row - piece.row) : { ok: false, message: 'House not found.' };
    }
    if (piece.kind === 'barn') {
      if (!canMove(piece, col, row)) return { ok: false, message: 'Cannot move the barn there — every room and incubator needs clear ground.' };
      const result = window.FarmBuildings.moveGroup(piece.roomIds, col - piece.col, row - piece.row, piece.rects.map(rect => rect.id));
      if (result.ok) window.BarnIncubator?.rebuildExteriorAll?.(); // Incubators are stored relative to their barn; re-seat their meshes and tiles.
      return result;
    }
    if (piece.kind === 'production') return window.FarmProduction.move(piece.id, col, row);
    return window.FarmCrates.moveShippingBox(col, row);
  }

  function createAdapter(selectedId = null) {
    let cached = null;
    const pieces = () => cached || (cached = [housePiece(), ...barnPieces(), ...productionPieces(), shippingPiece()].filter(Boolean));
    const find = id => pieces().find(piece => piece.id === id) || null;
    return {
      kind: 'farm', title: 'Farm Layout', listTitle: 'Structures', selectedId,
      noPermissionHint: "Only the farm's owner (or a granted farmhand) can rearrange the farm.",
      getPieces: pieces,
      refresh: () => { cached = null; },
      getViewPieces: () => [{ col: 0, row: 0, w: deps.COLS, h: deps.ROWS }], // Frame the whole farm.
      label, icon,
      canDrag: () => canAlter(),
      resolveMove: (piece, col, row) => ({ col, row, w: piece.w, h: piece.h }),
      canMove, move,
      place(world, mode) {
        const piece = mode?.type === 'moveStructure' ? find(mode.id) : null; // Tap-to-move fallback for controller and keyboard users.
        if (!piece) return { ok: false, message: 'Structure not found.' };
        const result = move(piece, Math.round(world.x - piece.w / 2), Math.round(world.z - piece.h / 2));
        return { ...result, addition: result.ok ? piece : null }; // Keeps the moved structure selected.
      },
      getHint: mode => mode?.type === 'moveStructure' ? `Tap where the ${label(find(mode.id) || {})} should go.`
        : 'Drag a structure to move it. Tap one to select it; production buildings can also be rotated.',
      debugSnapshot: () => ({ pieces: pieces().map(({ rects, ...piece }) => ({ ...piece, parts: rects?.length || 1 })) }),
      renderSidebar(ui) {
        ui.actions.innerHTML = ''; ui.architecture.innerHTML = ''; ui.deeds.innerHTML = '';
        const piece = find(ui.selectedId);
        if (!piece) return;
        const button = (text, action, disabled = false) => {
          const node = document.createElement('button');
          node.type = 'button'; node.className = 'settings-small-btn'; node.textContent = text; node.disabled = disabled;
          node.addEventListener('click', action); ui.actions.appendChild(node); return node;
        };
        const report = result => { deps.showToast(result.message, result.ok); ui.refresh(); window.FarmPanel?.render?.(); };
        const moving = ui.mode?.type === 'moveStructure' && ui.mode.id === piece.id;
        button(moving ? 'Cancel Move' : 'Move (tap)', () => ui.arm(moving ? null : { type: 'moveStructure', id: piece.id }), !canAlter());
        if (piece.kind === 'production') button('Rotate 90°', () => report(window.FarmProduction.rotate(piece.id)), !canAlter());
        if (piece.kind === 'house') button('Edit Rooms', () => window.FarmPanel.openLayoutEditor());
        if (piece.kind === 'barn' && !piece.foundation) button('Edit Barn', () => window.BarnIncubator?.openBarnEditor?.(piece.anchorId));
        if (piece.kind === 'house' || piece.kind === 'barn') {
          const note = document.createElement('div');
          note.className = 'farm-note';
          note.textContent = piece.kind === 'house' ? 'The house moves as one structure. Rotate individual rooms from Edit Rooms.'
            : 'The barn moves as one structure, carrying its connected rooms and incubators.';
          ui.architecture.appendChild(note);
        }
      },
    };
  }

  function open(selectedId = null) {
    if (!window.FarmPanel?.openLayoutEditor) return { ok: false, message: 'Layout editor is not ready.' };
    window.FarmPanel.openLayoutEditor(createAdapter(selectedId));
    return { ok: true, message: 'Opened the farm layout editor.' };
  }

  // One row at the top of the Farm tab's buildings list.
  function renderLauncher(list) {
    if (!deps || !list) return;
    const row = document.createElement('div');
    row.className = 'farm-row';
    row.dataset.farmBuildingKind = 'farmLayout';
    const name = document.createElement('span');
    name.className = 'farm-row-name'; name.textContent = '🗺 Farm Layout';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'settings-small-btn'; btn.textContent = 'Edit Layout';
    btn.addEventListener('click', () => open());
    row.append(name, btn);
    list.appendChild(row);
  }

  window.FarmLayoutEditor = { init, open, createAdapter, renderLauncher };
})();
