    // Early debug bootstrap: installed before game code so startup crashes are captured.
    window.__farmDebugLog = [];
    window.__farmLog = function farmLog(message, level) {
      const stamp = new Date().toLocaleTimeString();
      const lvl   = level || 'info';
      const entry = { t: stamp, lvl, msg: String(message) };
      window.__farmDebugLog.push(entry);
      if (window.__farmDebugLog.length > 200) window.__farmDebugLog.shift();
      _renderDebugPanel();
    };

    // Active debug-panel filter tab — see the data-filter buttons in
    // index.html and the click wiring in game.js. 'all' shows everything.
    window.__debugLogFilter = window.__debugLogFilter || 'all';

    const AUDIO_LEVELS = { audio: true, bgm: true, cue: true, bgs: true };
    const NAMED_LEVELS = { audio: true, bgm: true, cue: true, bgs: true, error: true, warn: true, info: true };
    function _isScheduleEntry(e) { return e.msg.startsWith('[schedule]'); }
    function _matchesDebugFilter(e, filter) {
      switch (filter) {
        case 'all':      return true;
        case 'schedule': return _isScheduleEntry(e);
        case 'audio':    return !!AUDIO_LEVELS[e.lvl];
        case 'warn':
        case 'info':     return e.lvl === filter && !_isScheduleEntry(e);
        case 'error':    return e.lvl === 'error';
        // Everything not claimed by a named tab above — fish/promise/
        // wildlife/etc, or any future ad-hoc level.
        case 'other':    return !NAMED_LEVELS[e.lvl];
        default:         return true;
      }
    }

    function _renderDebugPanel() {
      const panel = document.getElementById('debugLog');
      if (!panel) return;
      // 'wildlife' is its own previously-unused color — wild-animal spawn/
      // AI-direction failures and fallbacks (see game.js's den/pack system
      // and updateHostiles/updateCompanions) log at this level specifically
      // so they stand out from every other debug category at a glance.
      const COLOR = { error: '#f87171', warn: '#fb923c', promise: '#c084fc', info: '#d1d5db', fish: '#60a5fa', audio: '#ff66cc', bgm: '#4ade80', cue: '#4ade80', bgs: '#fada5e', wildlife: '#22d3ee' };
      // Only follow new entries to the bottom if the user hasn't scrolled up
      // to read older ones — otherwise re-rendering would yank them back down.
      const stuckToBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 16;
      const prevScrollTop = panel.scrollTop;
      const filter = window.__debugLogFilter || 'all';
      panel.innerHTML = window.__farmDebugLog
        .filter(e => _matchesDebugFilter(e, filter))
        .map(e => {
          const c = COLOR[e.lvl] || COLOR.info;
          const safe = e.msg.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/fallback/gi, m => `<span style="color:#f87171;font-weight:bold">${m}</span>`);
          return `<span style="color:#6b7280">[${e.t}]</span> <span style="color:${c}">${safe}</span>`;
        }).join('\n');
      panel.scrollTop = stuckToBottom ? panel.scrollHeight : prevScrollTop;
    }

    window._renderDebugPanel = _renderDebugPanel;
    // Exposed so copyDebugLog() (game.js) can export only what the active
    // filter tab is showing, instead of always exporting everything.
    window.__debugLogMatchesFilter = _matchesDebugFilter;

    // Tool-metal diagnostics are intentionally owned by the debug bootstrap
    // instead of game.js. The recolor module reads this same localStorage key
    // on every request, so the switch takes effect immediately and persists
    // across reloads without adding verdigris-specific state to gameplay code.
    const TOOL_METAL_DEBUG_KEY = 'toolMetalRecolorDebug';
    function _toolMetalDebugEnabled() {
      if (window.ToolMetalRecolorDebug === true) return true;
      try { return window.localStorage?.getItem(TOOL_METAL_DEBUG_KEY) === '1'; }
      catch { return false; }
    }

    function _setToolMetalDebugEnabled(enabled) {
      const on = !!enabled;
      window.ToolMetalRecolorDebug = on;
      try { window.localStorage?.setItem(TOOL_METAL_DEBUG_KEY, on ? '1' : '0'); } catch {}
      const btn = document.getElementById('debugVerdigrisBtn');
      if (btn) _renderToolMetalDebugButton(btn);

      // Starting a diagnostic run from a clean module cache makes the next
      // actual tool recolor report source matching, mask growth, outline, and
      // final canvas generation instead of only returning a cached canvas.
      if (on) window.ToolMetalRecolor?.clearCache?.();
      window.__farmLog(`Tool verdigris diagnostics ${on ? 'enabled' : 'disabled'}.`, 'info');
    }

    function _renderToolMetalDebugButton(btn) {
      const on = _toolMetalDebugEnabled();
      btn.textContent = `Verdigris logs: ${on ? 'On' : 'Off'}`;
      btn.setAttribute('aria-pressed', String(on));
      btn.style.fontSize = '11px';
      btn.style.padding = '3px 10px';
      btn.style.borderRadius = '6px';
      btn.style.cursor = 'pointer';
      btn.style.background = on ? 'rgba(52,211,153,.18)' : 'rgba(255,255,255,.08)';
      btn.style.border = on ? '1px solid rgba(52,211,153,.45)' : '1px solid rgba(255,255,255,.2)';
      btn.style.color = on ? '#34d399' : '#d1d5db';
    }

    function _installToolMetalDebugToggle() {
      if (document.getElementById('debugVerdigrisBtn')) return;
      const anchor = document.getElementById('debugProbeArmBtn');
      const controls = anchor?.parentElement;
      if (!controls) return;

      const btn = document.createElement('button');
      btn.id = 'debugVerdigrisBtn';
      btn.type = 'button';
      btn.title = 'Toggle detailed tool recolor / mastery verdigris diagnostics. This setting persists across reloads.';
      _renderToolMetalDebugButton(btn);
      btn.addEventListener('click', () => _setToolMetalDebugEnabled(!_toolMetalDebugEnabled()));
      controls.insertBefore(btn, anchor);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _installToolMetalDebugToggle, { once: true });
    } else {
      _installToolMetalDebugToggle();
    }

    // Exposed for any future debug UI that wants to mirror the same state.
    window.setToolMetalRecolorDebug = _setToolMetalDebugEnabled;

    window.addEventListener('error', function (event) {
      window.__farmLog(`${event.message} @ ${event.filename || 'inline'}:${event.lineno || '?'}:${event.colno || '?'}`, 'error');
    });
    window.addEventListener('unhandledrejection', function (event) {
      window.__farmLog(event.reason && event.reason.stack ? event.reason.stack : String(event.reason), 'promise');
    });
    window.__farmLog('early debug hooks installed');
