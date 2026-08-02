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

    window.addEventListener('error', function (event) {
      const loc = `${event.filename || 'inline'}:${event.lineno || '?'}:${event.colno || '?'}`;
      const stack = event.error && event.error.stack ? '\n' + event.error.stack : '';
      window.__farmLog(`${event.message} @ ${loc}${stack}`, 'error');
    });
    window.addEventListener('unhandledrejection', function (event) {
      window.__farmLog(event.reason && event.reason.stack ? event.reason.stack : String(event.reason), 'promise');
    });
    window.__farmLog('early debug hooks installed');
