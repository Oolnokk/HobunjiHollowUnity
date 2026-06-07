    // Early debug bootstrap: installed before game code so startup crashes are captured.
    window.__farmDebugLog = [];
    window.__farmLog = function farmLog(message, level) {
      const stamp = new Date().toLocaleTimeString();
      const entry = `[${stamp}] ${level || 'info'}: ${message}`;
      window.__farmDebugLog.push(entry);
      if (window.__farmDebugLog.length > 80) window.__farmDebugLog.shift();
      const panel = document.getElementById('debugPanel');
      if (panel) panel.textContent = window.__farmDebugLog.slice(-18).join('\n');
    };
    window.addEventListener('error', function (event) {
      window.__farmLog(`${event.message} @ ${event.filename || 'inline'}:${event.lineno || '?'}:${event.colno || '?'}`, 'error');
    });
    window.addEventListener('unhandledrejection', function (event) {
      window.__farmLog(event.reason && event.reason.stack ? event.reason.stack : String(event.reason), 'promise');
    });
    window.__farmLog('early debug hooks installed');
