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
      const COLOR = { error: '#f87171', warn: '#fb923c', promise: '#c084fc', info: '#d1d5db' };
      panel.innerHTML = window.__farmDebugLog.map(e => {
        const c = COLOR[e.lvl] || COLOR.info;
        const safe = e.msg.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        return `<span style="color:#6b7280">[${e.t}]</span> <span style="color:${c}">${safe}</span>`;
      }).join('\n');
      panel.scrollTop = panel.scrollHeight;
    }

    window._renderDebugPanel = _renderDebugPanel;

    window.addEventListener('error', function (event) {
      window.__farmLog(`${event.message} @ ${event.filename || 'inline'}:${event.lineno || '?'}:${event.colno || '?'}`, 'error');
    });
    window.addEventListener('unhandledrejection', function (event) {
      window.__farmLog(event.reason && event.reason.stack ? event.reason.stack : String(event.reason), 'promise');
    });
    window.__farmLog('early debug hooks installed');
