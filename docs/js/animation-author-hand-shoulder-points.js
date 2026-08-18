// Companion panel for Animation Author's existing Attachment Rig Coordinates mode.
// It deliberately leaves the giant authoring state machine alone: shoulder points are
// a small reusable species/gender profile, edited beside the existing posterior/perch
// controls and shared with the direct-hand runtime through hand-shoulder-points.js.
(function (global) {
  'use strict';
  if (!/\/tools\/animation-author\//.test(location.pathname) || global.__hobunjiShoulderPointAuthorInstalled) return;
  global.__hobunjiShoulderPointAuthorInstalled = true;

  const CONFIG_SRC = '../../config/hand-shoulder-points.js?v=20260818b';
  let selectedSide = 'right';
  let ui = null;

  function loadConfig() {
    if (global.HobunjiHandShoulderPoints) return Promise.resolve(global.HobunjiHandShoulderPoints);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = CONFIG_SRC;
      script.onload = () => global.HobunjiHandShoulderPoints ? resolve(global.HobunjiHandShoulderPoints) : reject(new Error('Shoulder point config did not initialize'));
      script.onerror = () => reject(new Error('Failed to load hand-shoulder-points.js'));
      document.head.appendChild(script);
    });
  }

  function selectedIdentity() {
    const card = document.querySelector('.npcCard.selected');
    const meta = card?.querySelector('.npcMeta')?.textContent || '';
    const parts = meta.split('·').map(part => part.trim()).filter(Boolean);
    if (parts.length >= 3) return { species: parts[1].replace(/_/g, '-'), gender: parts[2].toLowerCase() };

    const summary = document.getElementById('selectedMeta')?.textContent || '';
    const match = summary.match(/(?:species|speciesId)\s*[:=]\s*([\w-]+).*?(?:gender)\s*[:=]\s*(male|female)/i);
    return match ? { species: match[1].replace(/_/g, '-').toLowerCase(), gender: match[2].toLowerCase() } : null;
  }

  function identityLabel(identity) {
    return identity ? `${identity.species} / ${identity.gender}` : 'Select a character NPC';
  }

  function pointFor(side) {
    const identity = selectedIdentity();
    return identity && global.HobunjiHandShoulderPoints
      ? global.HobunjiHandShoulderPoints.pointFor(identity.species, identity.gender, side)
      : { x: 0, y: 0 };
  }

  function marker(side) {
    return document.getElementById(`hobunjiShoulderMarker_${side}`);
  }

  function updateMarkers() {
    const canvas = document.getElementById('frontCanvas');
    const wrap = canvas?.closest('.portraitCanvasWrap');
    if (!canvas || !wrap) return;
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    const authorVisible = document.getElementById('hobunjiHandShoulderAuthor')?.offsetParent != null;
    for (const side of ['left', 'right']) {
      let dot = marker(side);
      if (!dot) {
        dot = document.createElement('div');
        dot.id = `hobunjiShoulderMarker_${side}`;
        dot.title = `${side} hand shoulder point`;
        Object.assign(dot.style, {
          position: 'absolute', width: '12px', height: '12px', border: '2px solid white',
          borderRadius: '50%', transform: 'translate(-50%,-50%)', pointerEvents: 'none',
          boxShadow: '0 0 0 2px rgba(0,0,0,.65),0 0 9px currentColor', zIndex: '5',
          color: side === 'left' ? '#45d6a0' : '#ff7c90', background: 'currentColor',
        });
        wrap.appendChild(dot);
      }
      const point = pointFor(side);
      const authored = global.HobunjiHandShoulderPoints?.isAuthored(point);
      dot.style.display = authorVisible && authored ? 'block' : 'none';
      if (authorVisible && authored) {
        dot.style.left = `${point.x / 2}%`;
        dot.style.top = `${point.y / 2}%`;
      }
    }
  }

  function syncUi() {
    if (!ui || !global.HobunjiHandShoulderPoints) return;
    const identity = selectedIdentity();
    ui.identity.textContent = identityLabel(identity);
    for (const side of ['left', 'right']) {
      const point = pointFor(side);
      ui[`${side}X`].value = Number(point.x).toFixed(2).replace(/\.00$/, '');
      ui[`${side}Y`].value = Number(point.y).toFixed(2).replace(/\.00$/, '');
      ui[`${side}Fallback`].textContent = global.HobunjiHandShoulderPoints.isAuthored(point) ? 'manual' : '0,0 → fallback scan';
    }
    ui.leftBtn.classList.toggle('active', selectedSide === 'left');
    ui.rightBtn.classList.toggle('active', selectedSide === 'right');
    ui.status.textContent = identity
      ? `Click the front portrait to place the ${selectedSide} shoulder, or type 200×200 portrait coordinates. 0,0 invokes automatic main-mass detection.`
      : 'Select a character NPC first.';
    updateMarkers();
  }

  function setPoint(side, x, y) {
    const identity = selectedIdentity();
    if (!identity || !global.HobunjiHandShoulderPoints) return false;
    global.HobunjiHandShoulderPoints.setPoint(identity.species, identity.gender, side, { x, y });
    global.HobunjiHandShoulderPoints.saveLocal();
    syncUi();
    return true;
  }

  function downloadJson(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
  }

  function makePanel(host) {
    const panel = document.createElement('div');
    panel.id = 'hobunjiHandShoulderAuthor';
    panel.style.marginTop = '10px';
    panel.style.paddingTop = '10px';
    panel.style.borderTop = '1px solid rgba(255,255,255,.10)';
    panel.innerHTML = `
      <div class="maaSectionTitle"><b>Hand shoulder points</b><span class="maaSmall maaMuted" id="hobunjiShoulderIdentity">Select a character NPC</span></div>
      <div class="maaSmall maaMuted">These are the left/right shoulder targets used by 3D hand compass aiming. Coordinates use the front portrait's canonical 200×200 pixel space. <b>0,0 means automatic fallback</b>: largest opaque arm mass → top third → recropped bounds center.</div>
      <div class="segmented" style="margin-top:8px">
        <button type="button" id="hobunjiShoulderSideLeft" class="secondary">Place LEFT shoulder</button>
        <button type="button" id="hobunjiShoulderSideRight" class="secondary active">Place RIGHT shoulder</button>
      </div>
      <div class="authorGrid" style="margin-top:8px">
        <div class="transformSection"><b>Left shoulder</b>
          <div class="axisGrid" style="grid-template-columns:1fr 1fr">
            <div class="axisField"><label>X px</label><input id="hobunjiLeftShoulderX" type="number" step="0.5" value="0"></div>
            <div class="axisField"><label>Y px</label><input id="hobunjiLeftShoulderY" type="number" step="0.5" value="0"></div>
          </div><div class="maaSmall maaMuted" id="hobunjiLeftShoulderFallback"></div>
          <button type="button" id="hobunjiLeftShoulderReset" class="secondary" style="margin-top:6px">Set 0,0 fallback</button>
        </div>
        <div class="transformSection"><b>Right shoulder</b>
          <div class="axisGrid" style="grid-template-columns:1fr 1fr">
            <div class="axisField"><label>X px</label><input id="hobunjiRightShoulderX" type="number" step="0.5" value="0"></div>
            <div class="axisField"><label>Y px</label><input id="hobunjiRightShoulderY" type="number" step="0.5" value="0"></div>
          </div><div class="maaSmall maaMuted" id="hobunjiRightShoulderFallback"></div>
          <button type="button" id="hobunjiRightShoulderReset" class="secondary" style="margin-top:6px">Set 0,0 fallback</button>
        </div>
      </div>
      <div class="row" style="margin-top:8px">
        <button type="button" id="hobunjiShoulderDownloadJson" class="secondary">Download shoulder JSON</button>
        <button type="button" id="hobunjiShoulderCopyJson" class="secondary">Copy shoulder JSON</button>
        <button type="button" id="hobunjiShoulderResetAll" class="secondary">Reset all shoulders to 0,0</button>
      </div>
      <div class="maaSmall maaMuted" id="hobunjiShoulderStatus" style="margin-top:7px"></div>
    `;
    host.appendChild(panel);

    ui = {
      identity: panel.querySelector('#hobunjiShoulderIdentity'),
      leftBtn: panel.querySelector('#hobunjiShoulderSideLeft'),
      rightBtn: panel.querySelector('#hobunjiShoulderSideRight'),
      leftX: panel.querySelector('#hobunjiLeftShoulderX'), leftY: panel.querySelector('#hobunjiLeftShoulderY'),
      rightX: panel.querySelector('#hobunjiRightShoulderX'), rightY: panel.querySelector('#hobunjiRightShoulderY'),
      leftFallback: panel.querySelector('#hobunjiLeftShoulderFallback'), rightFallback: panel.querySelector('#hobunjiRightShoulderFallback'),
      status: panel.querySelector('#hobunjiShoulderStatus'),
    };

    ui.leftBtn.onclick = () => { selectedSide = 'left'; syncUi(); };
    ui.rightBtn.onclick = () => { selectedSide = 'right'; syncUi(); };
    const bindPair = side => {
      const x = ui[`${side}X`], y = ui[`${side}Y`];
      const apply = () => setPoint(side, Number(x.value) || 0, Number(y.value) || 0);
      x.addEventListener('change', apply); y.addEventListener('change', apply);
    };
    bindPair('left'); bindPair('right');
    panel.querySelector('#hobunjiLeftShoulderReset').onclick = () => setPoint('left', 0, 0);
    panel.querySelector('#hobunjiRightShoulderReset').onclick = () => setPoint('right', 0, 0);
    panel.querySelector('#hobunjiShoulderResetAll').onclick = () => {
      global.HobunjiHandShoulderPoints.clearLocal();
      syncUi();
    };
    panel.querySelector('#hobunjiShoulderDownloadJson').onclick = () => {
      downloadJson('hand-shoulder-points.json', global.HobunjiHandShoulderPoints.serialize());
      ui.status.textContent = 'Downloaded hand-shoulder-points.json.';
    };
    panel.querySelector('#hobunjiShoulderCopyJson').onclick = async () => {
      try {
        await navigator.clipboard.writeText(global.HobunjiHandShoulderPoints.serialize());
        ui.status.textContent = 'Copied hand shoulder profile JSON.';
      } catch (_) { ui.status.textContent = 'Clipboard copy failed.'; }
    };

    const frontCanvas = document.getElementById('frontCanvas');
    frontCanvas?.addEventListener('pointerdown', event => {
      // The portrait remains visible in several author modes. Shoulder placement is
      // only armed while this Attachment Rig Coordinates panel is actually visible.
      if (!panel.isConnected || panel.offsetParent == null) return;
      const identity = selectedIdentity();
      if (!identity) return;
      const rect = frontCanvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = Math.max(0, Math.min(200, (event.clientX - rect.left) / rect.width * 200));
      const y = Math.max(0, Math.min(200, (event.clientY - rect.top) / rect.height * 200));
      setPoint(selectedSide, x, y);
    });

    document.getElementById('npcList')?.addEventListener('click', () => setTimeout(syncUi, 0));
    new MutationObserver(syncUi).observe(document.getElementById('selectedMeta') || document.body, { childList: true, subtree: true, characterData: true });
    new MutationObserver(updateMarkers).observe(host, { attributes: true, attributeFilter: ['class','style'] });
    global.addEventListener('resize', updateMarkers);
    syncUi();
  }

  async function install() {
    try {
      await loadConfig();
      global.HobunjiHandShoulderPoints.loadLocal();
      let tries = 0;
      const findHost = () => {
        const host = document.getElementById('maaRigLibrarySection');
        if (host) return makePanel(host);
        if (++tries < 120) setTimeout(findHost, 100);
      };
      findHost();
    } catch (error) {
      console.warn('[animation-author-hand-shoulders] install failed:', error);
    }
  }

  install();
})(window);