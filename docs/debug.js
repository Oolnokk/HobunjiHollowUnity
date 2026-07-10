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
      panel.innerHTML = window.__farmDebugLog.map(e => {
        const c = COLOR[e.lvl] || COLOR.info;
        const safe = e.msg.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
          .replace(/fallback/gi, m => `<span style="color:#f87171;font-weight:bold">${m}</span>`);
        return `<span style="color:#6b7280">[${e.t}]</span> <span style="color:${c}">${safe}</span>`;
      }).join('\n');
      panel.scrollTop = stuckToBottom ? panel.scrollHeight : prevScrollTop;
    }

    window._renderDebugPanel = _renderDebugPanel;

    window.addEventListener('error', function (event) {
      window.__farmLog(`${event.message} @ ${event.filename || 'inline'}:${event.lineno || '?'}:${event.colno || '?'}`, 'error');
    });
    window.addEventListener('unhandledrejection', function (event) {
      window.__farmLog(event.reason && event.reason.stack ? event.reason.stack : String(event.reason), 'promise');
    });
    window.__farmLog('early debug hooks installed');
