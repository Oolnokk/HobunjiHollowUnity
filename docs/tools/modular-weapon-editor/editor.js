(function () {
  'use strict';
  const api = window.ModularWeapons; // Shared runtime compositor and import validator.
  const byId = id => document.getElementById(id); // Tool-local element lookup.
  let data = JSON.parse(JSON.stringify(api.getConfig())); // Editable draft; canonical runtime data changes only through validation.
  let socketIndex = 0; // Active socket on the selected shaft.
  let serial = 0; // Prevent late image loads from overwriting a newer preview.
  const selectedShaft = () => data.shafts[byId('shaft').value]; // Current shaft authoring record.
  const selectedHead = () => data.heads[byId('head').value]; // Current head pivot record.
  function message(text) { byId('status').textContent = text; }
  function options(id, entries) {
    for (const [key, value] of Object.entries(entries)) {
      const option = document.createElement('option'); // Stable manifest keys are also exported game keys.
      option.value = key; option.textContent = value.label; byId(id).appendChild(option);
    }
  }
  function save() {
    try { data = JSON.parse(JSON.stringify(api.replace(data, true))); message('Draft saved. Preview and game share these attachment settings.'); render(); }
    catch (error) { message(`Could not save: ${error.message}`); }
  }
  function marker(ctx, point, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(point.x, point.y, 17, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(point.x - 26, point.y); ctx.lineTo(point.x + 26, point.y); ctx.moveTo(point.x, point.y - 26); ctx.lineTo(point.x, point.y + 26); ctx.stroke();
  }
  async function preview() {
    const request = ++serial, shaftKey = byId('shaft').value, headKey = byId('head').value; // Snapshot this render's identity.
    const shaft = selectedShaft(), head = selectedHead(); // Records matching the request.
    try {
      const [shaftImage, headImage, composed] = await Promise.all([api.loadImage(shaft.sprite, '../../'), api.loadImage(head.sprite, '../../'), api.compose(shaftKey, headKey, '../../')]); // Reuses cached bitmaps, no animation loop.
      if (request !== serial) return;
      for (const [id, image] of [['shaft-canvas', shaftImage], ['head-canvas', headImage], ['preview', composed]]) {
        const context = byId(id).getContext('2d'); // Original sprite coordinates displayed without cropping.
        context.clearRect(0, 0, 450, 1204); context.drawImage(image, 0, 0, 450, 1204);
        if (id === 'shaft-canvas') shaft.attachments.forEach((point, index) => marker(context, point, index === socketIndex ? '#ffd16c' : '#63e1cf'));
        if (id === 'head-canvas') marker(context, head.attach, '#ffd16c');
      }
      byId('debug').textContent = JSON.stringify({ shaft: shaftKey, head: headKey, sourceWeapon: shaft.sourceShape, sockets: shaft.attachments, headPivot: head.attach, effective: api.settings(shaftKey, headKey), disallowed: api.isDisallowed(shaftKey, headKey), revision: api.diagnostics('').revision }, null, 2);
    } catch (error) { if (request === serial) message(`Preview failed: ${error.message}`); }
  }
  function render() {
    const shaft = selectedShaft(), headKey = byId('head').value; // Active settings scope.
    const overrideMode = byId('mode').value === 'override'; // Checkboxes are meaningful only for an individual head exception.
    const values = overrideMode ? (shaft.overrides[headKey] || {}) : shaft.defaults; // Sparse override fields inherit their shaft defaults.
    const effective = api.settings(byId('shaft').value, headKey); // Resolved values displayed for unchecked fields.
    socketIndex = Math.min(socketIndex, shaft.attachments.length - 1);
    byId('socket').replaceChildren();
    shaft.attachments.forEach((_, index) => {
      const option = document.createElement('option'); // Socket picker for twin/multi-ended weapons.
      option.value = index; option.textContent = `Socket ${index + 1}`; byId('socket').appendChild(option);
    });
    byId('socket').value = socketIndex;
    byId('remove').disabled = shaft.attachments.length <= 1;
    byId('add').disabled = shaft.attachments.length >= (shaft.maxAttachments || 8);
    byId('disallow').checked = api.isDisallowed(byId('shaft').value, headKey);
    byId('attach-controls').replaceChildren();
    for (const key of ['x', 'y', 'rotation']) {
      const label = document.createElement('label'), input = document.createElement('input'); // Numeric alternative to tapping, including per-socket rotation.
      label.textContent = `Socket ${key}`; input.type = 'number'; input.step = '1'; input.value = shaft.attachments[socketIndex][key];
      input.onchange = () => { shaft.attachments[socketIndex][key] = Number(input.value); save(); };
      label.appendChild(input); byId('attach-controls').appendChild(label);
    }
    byId('fields').replaceChildren();
    for (const key of [...api.transforms, 'animation']) {
      const row = document.createElement('tr'), title = document.createElement('td'), toggleCell = document.createElement('td'), valueCell = document.createElement('td'); // One inheritance control per value.
      const toggle = document.createElement('input'), input = document.createElement(key === 'animation' ? 'select' : 'input'); // Checkbox and its editable transform value.
      const boolean = key.startsWith('flip'); // Flip transforms use a checkbox rather than a numeric flag.
      title.textContent = key; toggle.type = 'checkbox'; toggle.checked = !overrideMode || Object.hasOwn(values, key); toggle.disabled = !overrideMode;
      toggle.setAttribute('aria-label', `Override ${key}`);
      input.setAttribute('aria-label', key === 'animation' ? 'Attack animation' : key);
      if (key === 'animation') {
        title.textContent = 'Attack animation';
        for (const style of ['thrust', 'sweep']) {
          const option = document.createElement('option'); // Named motion styles, authored without code.
          option.value = style; option.textContent = style === 'thrust' ? 'Thrust' : 'Sweep'; input.appendChild(option);
        }
        input.value = overrideMode ? effective[key] : values[key];
      } else {
        input.type = boolean ? 'checkbox' : 'number'; input.step = key.startsWith('scale') ? '.01' : '1';
        if (boolean) input.checked = overrideMode ? effective[key] : values[key]; else input.value = overrideMode ? effective[key] : values[key];
      }
      input.disabled = !toggle.checked;
      toggle.onchange = () => {
        if (!shaft.overrides[headKey]) shaft.overrides[headKey] = {};
        if (toggle.checked) shaft.overrides[headKey][key] = effective[key]; else delete shaft.overrides[headKey][key];
        save();
      };
      input.onchange = () => {
        if (overrideMode && !shaft.overrides[headKey]) shaft.overrides[headKey] = {};
        (overrideMode ? shaft.overrides[headKey] : shaft.defaults)[key] = boolean ? input.checked : key === 'animation' ? input.value : Number(input.value);
        save();
      };
      toggleCell.appendChild(toggle); valueCell.appendChild(input); row.append(title, toggleCell, valueCell); byId('fields').appendChild(row);
    }
    preview();
  }
  function place(id, update) {
    byId(id).addEventListener('pointerdown', event => {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect(); // Responsive CSS is mapped back to original pixel coordinates.
      update({ x: Math.round((event.clientX - rect.left) / rect.width * 450), y: Math.round((event.clientY - rect.top) / rect.height * 1204) }); save();
    });
  }
  options('shaft', data.shafts); options('head', data.heads);
  byId('shaft').onchange = () => { socketIndex = 0; render(); };
  byId('head').onchange = render; byId('mode').onchange = render;
  byId('socket').onchange = () => { socketIndex = Number(byId('socket').value); render(); };
  byId('disallow').onchange = () => {
    const shaft = selectedShaft(), head = byId('head').value; // Pair policy is independent of which transform editing mode is selected.
    if (!shaft.overrides[head]) shaft.overrides[head] = {};
    shaft.overrides[head].disallow = byId('disallow').checked; save();
  };
  byId('add').onclick = () => { if (selectedShaft().attachments.length >= (selectedShaft().maxAttachments || 8)) return; selectedShaft().attachments.push({ x: 225, y: 50, rotation: 180 }); socketIndex = selectedShaft().attachments.length - 1; save(); };
  byId('remove').onclick = () => { if (selectedShaft().attachments.length > 1) { selectedShaft().attachments.splice(socketIndex, 1); socketIndex = 0; save(); } };
  place('shaft-canvas', point => Object.assign(selectedShaft().attachments[socketIndex], point));
  place('head-canvas', point => { selectedHead().attach = point; });
  byId('export').onclick = () => {
    const blob = new Blob(['// Foundry sprite attachment configuration.\nwindow.MODULAR_WEAPON_CONFIG = ' + JSON.stringify(data, null, 2) + ';\n'], { type: 'text/javascript' }); // Drop-in committed config; never eval imports.
    const url = URL.createObjectURL(blob), anchor = document.createElement('a'); // Browser download works on mobile as well.
    anchor.href = url; anchor.download = 'modular-weapons.js'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  byId('import').onclick = () => byId('file').click();
  byId('file').onchange = async () => {
    try {
      const text = await byId('file').files[0].text(); // Accept JSON or the exported JS assignment as data, never executable code.
      const json = text.trim().startsWith('{') ? text : text.slice(text.indexOf('=') + 1).trim().replace(/;\s*$/, ''); // Removes only the export assignment envelope.
      data = JSON.parse(JSON.stringify(api.replace(JSON.parse(json), true))); message('Imported attachment configuration.'); render();
    } catch (error) { message(`Import failed: ${error.message}`); }
    byId('file').value = '';
  };
  byId('reset').onclick = () => { data = JSON.parse(JSON.stringify(api.replace(window.MODULAR_WEAPON_CONFIG, true))); message('Restored committed attachment settings.'); render(); };
  message('Ready. Tap sprites to set attachment points.'); render();
})();
