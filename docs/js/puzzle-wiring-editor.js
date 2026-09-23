// Shared two-tap activator -> mechanism wiring UI for grid editors.
(() => {
  'use strict';
  const adapter = window.PuzzleWiringEditorAdapter;
  const puzzleApi = window.FurniturePuzzleProperties;
  if (!adapter || !puzzleApi) return;
  let sourceId = '';

  const button = document.createElement('button');
  button.type = 'button'; button.className = 'sec'; button.dataset.mode = 'puzzle-wire';
  button.textContent = '⚡ Wire'; button.title = 'Wire activator furniture to mechanism furniture';
  adapter.modeBar().insertBefore(button, adapter.modeBar().querySelector('#fitBtn'));

  const section = document.createElement('div');
  section.className = 'section'; section.id = 'puzzleWiringSection';
  section.style.cssText = '--sec:#facc15;--secBg:rgba(250,204,21,.08);display:none';
  section.innerHTML = `<div class="sect-head"><b>Activator Wiring</b><span class="sect-tag" id="puzzleWireCount">0 wires</span></div>
    <p class="muted" id="puzzleWireHelp">Tap activator furniture, then mechanism furniture. Tap a wire below to remove it.</p>
    <div id="puzzleWireList" class="itemlist"></div>`;
  adapter.sidebar().appendChild(section);

  function nodes() { return adapter.nodes().filter(node => node?.id); }
  function nodeById(id) { return nodes().find(node => String(node.id) === String(id)); }
  function render() {
    const wiring = puzzleApi.normalizeWiring(adapter.getWiring());
    document.getElementById('puzzleWireCount').textContent = `${wiring.length} wire${wiring.length === 1 ? '' : 's'}`;
    document.getElementById('puzzleWireHelp').textContent = sourceId
      ? `Activator selected: ${nodeById(sourceId)?.label || sourceId}. Now tap a mechanism.`
      : 'Tap activator furniture, then mechanism furniture. Tap a wire below to remove it.';
    const list = document.getElementById('puzzleWireList');
    list.innerHTML = wiring.length ? '' : '<div class="muted">No wiring yet.</div>';
    for (const wire of wiring) {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'sec';
      row.style.cssText = 'display:block;width:100%;margin-top:4px;text-align:left';
      row.textContent = `${nodeById(wire.fromId)?.label || wire.fromId} → ${nodeById(wire.toId)?.label || wire.toId}`;
      row.onclick = () => { adapter.setWiring(wiring.filter(item => item.id !== wire.id)); adapter.changed(); render(); adapter.draw(); };
      list.appendChild(row);
    }
  }

  button.addEventListener('click', () => {
    sourceId = ''; adapter.setMode('puzzle-wire'); section.style.display = ''; render(); adapter.draw();
  });
  adapter.modeBar().addEventListener('click', event => {
    const mode = event.target.closest?.('[data-mode]')?.dataset.mode;
    if (mode && mode !== 'puzzle-wire') { sourceId = ''; section.style.display = 'none'; }
  });
  adapter.canvas().addEventListener('pointerdown', event => {
    if (adapter.getMode() !== 'puzzle-wire') return;
    event.preventDefault(); event.stopImmediatePropagation();
    const cell = adapter.cellFromEvent(event);
    const node = adapter.hitNode(cell);
    if (!node) { sourceId = ''; render(); adapter.draw(); return; }
    const puzzle = puzzleApi.normalizePuzzle(node.puzzle);
    if (!sourceId) {
      if (puzzle?.role !== 'activator') { adapter.status(`${node.label || node.id} is not activator furniture.`); return; }
      sourceId = String(node.id); render(); adapter.draw(); return;
    }
    if (puzzle?.role !== 'mechanism') { adapter.status(`${node.label || node.id} is not mechanism furniture.`); return; }
    const wiring = puzzleApi.normalizeWiring(adapter.getWiring());
    wiring.push({ id:`wire_${Date.now().toString(36)}`, fromId:sourceId, toId:String(node.id), invert:false, delaySeconds:0 });
    adapter.setWiring(puzzleApi.normalizeWiring(wiring)); sourceId = '';
    adapter.changed(); render(); adapter.draw(); adapter.status('Activator wired to mechanism.');
  }, true);

  window.PuzzleWiringEditor = Object.freeze({ render, selectedSourceId: () => sourceId });
})();
