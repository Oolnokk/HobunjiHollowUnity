// Ruin objective tracker — a small, always-visible dungeon checklist in the
// top-left corner while the player is inside a generated ruin (the corner the
// wilderness minimap uses outdoors). It answers "what am I doing here?" at a
// glance, the way a dungeon HUD does:
//
//     Sunken Halls of Hronal
//     ◆ Wing braziers      3 / 12
//     ◆ Trials cleared     4 / 9
//     ◆ Door seals         0 / 4
//     ◇ Great Door — sealed
//
// Data only comes from the owners' existing read APIs
// (DevRandomRuin.getShaftNetworkState / getTitle, DevRandomRuinSanctum.getState);
// nothing here changes ruin state. It polls at 4 Hz from a RuntimeFrameScheduler
// post-game subscriber and only touches the DOM when the text actually changes
// (AGENTS.md recurring mistake #6). A row whose count just went up pulses once.
(() => {
  'use strict';

  const MAP_ID = 'map_i_dev_random_ruin';
  const POLL_MS = 250;
  const STORAGE_KEY = 'hobunjiRuinTracker';

  let root = null, titleEl = null, listEl = null;
  let lastAt = -Infinity;
  let lastSignature = '';
  let visible = false;
  const lastCounts = new Map();

  function enabled() {
    try { return localStorage.getItem(STORAGE_KEY) !== '0'; } catch (_) { return true; }
  }

  function ensureDom() {
    if (root || typeof document === 'undefined' || !document.body) return root;
    const style = document.createElement('style');
    style.id = 'ruinObjectiveTrackerStyle';
    style.textContent = `
      #ruinObjectiveTracker{position:fixed;left:12px;top:64px;z-index:30;pointer-events:none;
        min-width:190px;max-width:min(300px,60vw);padding:8px 12px 9px;border-radius:10px;
        background:var(--game-ui-surface,rgba(8,18,13,.38));border:1px solid var(--game-ui-line,rgba(255,255,255,.13));
        color:#eef3ea;font-weight:600;font-size:13px;line-height:1.35;text-shadow:var(--game-ui-text-outline,0 1px 2px #000);
        opacity:0;transform:translateX(-12px);transition:opacity .35s ease,transform .35s ease;}
      #ruinObjectiveTracker.show{opacity:1;transform:none;}
      #ruinObjectiveTracker .rot-title{color:#f9e28a;font-size:14px;margin-bottom:4px;letter-spacing:.02em;}
      #ruinObjectiveTracker .rot-row{display:flex;justify-content:space-between;gap:14px;white-space:nowrap;}
      #ruinObjectiveTracker .rot-row.done{color:#9fe0a6;}
      #ruinObjectiveTracker .rot-row.pulse{animation:rotPulse .9s ease-out 1;}
      @keyframes rotPulse{0%{transform:scale(1.12);color:#fff7c2;}100%{transform:none;}}
      @media (max-width:600px){#ruinObjectiveTracker{top:56px;font-size:12px;min-width:160px;}}
    `;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.id = 'ruinObjectiveTracker';
    root.setAttribute('aria-live', 'polite');
    titleEl = document.createElement('div');
    titleEl.className = 'rot-title';
    listEl = document.createElement('div');
    root.append(titleEl, listEl);
    document.body.appendChild(root);
    return root;
  }

  function inRuin() {
    return window.GridTileAccessors?.getCurrentArea?.() === MAP_ID;
  }

  // Pure: ruin read-model -> rows. Exported for tests.
  function buildRows({ shaft = null, sanctum = null } = {}) {
    const rows = [];
    if (shaft && Number(shaft.braziers) > 0) {
      rows.push({ key: 'wing', label: 'Wing braziers', have: Number(shaft.lit) || 0, need: Number(shaft.braziers) || 0 });
    }
    if (shaft && Number(shaft.challengesTotal) > 0) {
      rows.push({ key: 'trials', label: 'Trials cleared', have: Number(shaft.challengesSolved) || 0, need: Number(shaft.challengesTotal) || 0 });
    }
    const braziers = Array.isArray(sanctum?.braziers) ? sanctum.braziers : [];
    if (braziers.length) {
      rows.push({ key: 'seals', label: 'Door seals', have: braziers.filter(b => b?.lit).length, need: braziers.length });
    }
    const doorState = sanctum?.door?.state;
    if (doorState) {
      const text = { sealed: 'sealed', awake: 'awake — go to it', opening: 'opening…', open: 'open' }[doorState] || String(doorState);
      rows.push({ key: 'door', label: 'Great Door', text, done: doorState === 'open' || doorState === 'opening' });
    }
    return rows;
  }

  function render(title, rows) {
    ensureDom();
    if (!root) return;
    const signature = title + '|' + rows.map(r => r.key + ':' + (r.text ?? (r.have + '/' + r.need))).join('|');
    if (signature === lastSignature) return;
    lastSignature = signature;
    titleEl.textContent = title || 'Ancient Ruin';
    const pulses = [];
    listEl.replaceChildren(...rows.map(row => {
      const el = document.createElement('div');
      const done = row.done ?? (row.need > 0 && row.have >= row.need);
      el.className = 'rot-row' + (done ? ' done' : '');
      const label = document.createElement('span');
      label.textContent = (done ? '◆ ' : '◇ ') + row.label;
      const value = document.createElement('span');
      value.textContent = row.text ?? `${row.have} / ${row.need}`;
      el.append(label, value);
      const prev = lastCounts.get(row.key);
      if (Number.isFinite(row.have) && Number.isFinite(prev) && row.have > prev) pulses.push(el);
      if (Number.isFinite(row.have)) lastCounts.set(row.key, row.have);
      return el;
    }));
    for (const el of pulses) el.classList.add('pulse');
  }

  function setVisible(on) {
    if (on === visible) return;
    visible = on;
    ensureDom();
    root?.classList.toggle('show', on);
    if (!on) { lastSignature = ''; lastCounts.clear(); }
  }

  function poll(now = performance.now()) {
    if (now - lastAt < POLL_MS) return;
    lastAt = now;
    const show = enabled() && inRuin() && !window.GameFeel?.isRevealing?.();
    if (!show) { setVisible(false); return; }
    let shaft = null, sanctum = null;
    try { shaft = window.DevRandomRuin?.getShaftNetworkState?.() || null; } catch (_) {}
    try { sanctum = window.DevRandomRuinSanctum?.getState?.() || null; } catch (_) {}
    const rows = buildRows({ shaft, sanctum });
    if (!rows.length) { setVisible(false); return; }
    render(window.DevRandomRuin?.getTitle?.() || '', rows);
    setVisible(true);
  }

  function bindSettingsToggle() {
    const box = typeof document !== 'undefined' ? document.getElementById('settingRuinTracker') : null;
    if (!box || box.dataset.trackerBound) return;
    box.dataset.trackerBound = '1';
    box.checked = enabled();
    box.addEventListener('change', () => window.RuinObjectiveTracker.setEnabled(box.checked));
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener?.('DOMContentLoaded', bindSettingsToggle, { once: true });
    else bindSettingsToggle();
  }

  function install() {
    if (!window.RuntimeFrameScheduler?.register) return false;
    window.RuntimeFrameScheduler.register('ruin-objective-tracker', () => poll(), { phase: 'post-game', owner: 'ruin-objective-tracker', description: '4 Hz ruin checklist HUD; DOM writes only on change.' });
    return true;
  }
  if (!install()) window.addEventListener('load', install, { once: true });

  window.RuinObjectiveTracker = Object.freeze({
    buildRows, poll,
    setEnabled(on) { try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch (_) {} lastAt = -Infinity; poll(); },
    debugSnapshot: () => ({ visible, signature: lastSignature }),
  });
})();
