// Junction piece picker shared by the attachment editor's pair brush and the PNG cutter: piece list (bundled plus
// uploads discovered on main), scale/rotation/behind controls, and cached piece images.
(function (global) {
  'use strict';
  const api = global.ModularWeapons;
  const names = [...api.JUNCTIONS]; // Shared by every picker on the page.
  const pickers = [];
  const images = new Map(); // name → Promise<Image>
  const loaded = new Map(); // name → Image, once ready (for synchronous ghost drawing).
  const byId = id => document.getElementById(id);

  function fill(select) {
    const last = select.value;
    select.replaceChildren(...names.map(name => {
      const option = document.createElement('option');
      option.value = name; option.textContent = name.replace(/[_-]+/g, ' ');
      return option;
    }));
    if (names.includes(last)) select.value = last;
  }
  function image(name) {
    if (!images.has(name)) {
      const task = api.loadImage(api.junctionPath(name), '../../');
      task.then(img => loaded.set(name, img), () => images.delete(name));
      images.set(name, task);
    }
    return images.get(name);
  }
  async function refresh() {
    const response = await fetch('https://api.github.com/repos/Oolnokk/HobunjiHollowUnity/contents/docs/assets/toolsprites/modular_pieces?ref=main', { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const entries = await response.json();
    if (!Array.isArray(entries)) throw new Error('GitHub did not return a file list.');
    for (const entry of entries) {
      const match = /^weaponjunction_([a-z0-9_-]+)\.png$/i.exec(entry?.name || '');
      if (match && !names.includes(match[1])) names.push(match[1]);
    }
    for (const picker of pickers) fill(picker.select);
    return names.length;
  }

  // Wires the controls named <prefix>-junction, -junction-scale, -junction-rotation, -junction-behind and
  // -junction-refresh. onChange runs whenever the piece or its placement settings change (to redraw a ghost).
  function bind(prefix, onChange = () => {}) {
    const select = byId(prefix + '-junction'), scale = byId(prefix + '-junction-scale');
    const rotation = byId(prefix + '-junction-rotation'), behind = byId(prefix + '-junction-behind');
    pickers.push({ select });
    fill(select);
    const changed = () => {
      byId(prefix + '-junction-scale-value').textContent = Number(scale.value).toFixed(2).replace(/\.?0+$/, '');
      byId(prefix + '-junction-rotation-value').textContent = rotation.value;
      image(select.value).then(onChange, () => {});
      onChange();
    };
    for (const input of [select, scale, rotation, behind]) input.addEventListener('input', changed);
    select.addEventListener('change', changed);
    byId(prefix + '-junction-refresh').onclick = async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try { const count = await refresh(); button.textContent = 'Refresh pieces from main (' + count + ')'; }
      catch (error) { button.textContent = 'Refresh failed: ' + error.message; }
      finally { button.disabled = false; }
    };
    image(select.value).then(onChange, () => {});
    return {
      // Placement of the selected piece centred on a point in source pixels.
      placement: (x, y) => ({ junction: select.value, x, y, rotation: Number(rotation.value), scale: Number(scale.value),
        ...(behind.checked ? { behind: true } : {}) }),
      image
    };
  }

  // Draws a semi-transparent ghost of `piece` on ctx (which maps source pixels), if its image has loaded.
  function ghost(ctx, piece) {
    const img = loaded.get(piece.junction);
    if (!img) { image(piece.junction).catch(() => {}); return false; }
    ctx.save(); ctx.globalAlpha = 0.65;
    api.drawJunction(ctx, img, { ...piece, behind: false });
    ctx.restore();
    return true;
  }

  global.ModularJunctionPicker = Object.freeze({ bind, image, ghost, names: () => names.slice() });
})(window);
