    // Early debug bootstrap: installed before game code so startup crashes are captured.
    const DEBUG_HISTORY_MAX = 3000; // Used to retain a deep session history for narrowed debug categories.
    const DEBUG_ALL_VISIBLE_MAX = 200; // Used to keep the unfiltered All view compact even while deeper history is retained.
    window.__farmDebugLog = [];
    window.__farmLog = function farmLog(message, level) {
      const stamp = new Date().toLocaleTimeString();
      const lvl   = level || 'info';
      const entry = { t: stamp, lvl, msg: String(message) };
      window.__farmDebugLog.push(entry);
      if (window.__farmDebugLog.length > DEBUG_HISTORY_MAX) window.__farmDebugLog.shift();
      _renderDebugPanel();
    };

    // Active debug-panel filter tab — see the data-filter buttons in
    // index.html and the click wiring in game.js. 'all' shows only the recent
    // window; selecting a category exposes its full retained session history.
    window.__debugLogFilter = window.__debugLogFilter || 'all';
    window.__debugLogSubFilter = window.__debugLogSubFilter || 'all';

    const AUDIO_LEVELS = { audio: true, bgm: true, cue: true, bgs: true };
    const NAMED_LEVELS = { audio: true, bgm: true, cue: true, bgs: true, error: true, warn: true, info: true };
    const DEBUG_SUB_FILTERS = {
      audio: [
        { id: 'all', label: 'All Audio' },
        { id: 'footsteps', label: 'Footsteps' },
        { id: 'bgs', label: 'BGS' },
        { id: 'bgm', label: 'BGM' },
        { id: 'cue', label: 'Cues' },
        { id: 'loads', label: 'Loads' },
      ],
      schedule: [
        { id: 'all', label: 'All Schedule' },
        { id: 'lifecycle', label: 'Lifecycle' },
        { id: 'fallback', label: 'Fallbacks' },
        { id: 'spawn', label: 'Spawns' },
      ],
    }; // Used to build the second debug-filter row only for categories with useful subdivisions.

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

    function _matchesDebugSubFilter(e, filter, subFilter) {
      if (!subFilter || subFilter === 'all') return true;
      const msg = e.msg.toLowerCase(); // Used for lightweight message-family subdivision without changing every existing logger.
      if (filter === 'audio') {
        switch (subFilter) {
          case 'footsteps': return msg.includes('[footsteps]');
          case 'bgs':       return e.lvl === 'bgs' || msg.includes('[bgs]');
          case 'bgm':       return e.lvl === 'bgm' || msg.includes('[bgm]');
          case 'cue':       return e.lvl === 'cue' || msg.includes('[cue]');
          case 'loads':     return /loadstart|canplaythrough|marked audio failed|registered furniture sfx|measured loudness|audio unlock/.test(msg);
          default:          return true;
        }
      }
      if (filter === 'schedule') {
        switch (subFilter) {
          case 'lifecycle': return msg.includes('npc lifecycle');
          case 'fallback':  return /fallback|no rule matched/.test(msg);
          case 'spawn':     return /spawn/.test(msg);
          default:          return true;
        }
      }
      return true;
    }

    function _debugEntriesForFilter(filter, subFilter) {
      // The deep backlog is deliberately hidden in All. Choosing any category
      // switches to the complete retained history; a sub-tab narrows that same
      // backlog further instead of maintaining a second duplicate buffer.
      const source = filter === 'all'
        ? window.__farmDebugLog.slice(-DEBUG_ALL_VISIBLE_MAX)
        : window.__farmDebugLog;
      return source.filter(e => _matchesDebugFilter(e, filter)
        && _matchesDebugSubFilter(e, filter, subFilter));
    }

    function _debugSubTabStyle(active) {
      return active
        ? 'font-size:10px;padding:2px 8px;background:rgba(163,230,53,.18);border:1px solid rgba(163,230,53,.5);border-radius:10px;color:#a3e635;cursor:pointer'
        : 'font-size:10px;padding:2px 8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.16);border-radius:10px;color:#9ca3af;cursor:pointer';
    }

    function _ensureDebugSubFilterTabs(filter) {
      const mainTabs = document.getElementById('debugFilterTabs');
      if (!mainTabs) return;
      let row = document.getElementById('debugSubFilterTabs'); // Used as the dynamically-added second filter row under the existing primary tabs.
      if (!row) {
        row = document.createElement('div');
        row.id = 'debugSubFilterTabs';
        row.style.cssText = 'display:none;flex-wrap:wrap;gap:4px;padding:0 12px 6px;flex-shrink:0';
        mainTabs.insertAdjacentElement('afterend', row);
        row.addEventListener('click', event => {
          const button = event.target.closest('[data-debug-subfilter]');
          if (!button) return;
          window.__debugLogSubFilter = button.dataset.debugSubfilter || 'all';
          _renderDebugPanel();
        });
      }

      const choices = DEBUG_SUB_FILTERS[filter] || [];
      if (!choices.length) {
        window.__debugLogSubFilter = 'all';
        row.style.display = 'none';
        row.innerHTML = '';
        return;
      }
      if (!choices.some(choice => choice.id === window.__debugLogSubFilter)) {
        window.__debugLogSubFilter = 'all';
      }
      row.style.display = 'flex';
      row.innerHTML = choices.map(choice => {
        const active = choice.id === window.__debugLogSubFilter;
        return `<button type="button" data-debug-subfilter="${choice.id}" style="${_debugSubTabStyle(active)}">${choice.label}</button>`;
      }).join('');
    }

    function _renderDebugPanel() {
      const panel = document.getElementById('debugLog');
      if (!panel) return;
      // 'wildlife' is its own previously-unused color — wild-animal spawn/
      // AI-direction failures and fallbacks (see game.js's den/pack system
      // and updateHostiles/updateCompanions) log at this level specifically
      // so they stand out from every other debug category at a glance.
      const COLOR = { error: '#f87171', warn: '#fb923c', promise: '#c084fc', info: '#d1d5db', fish: '#60a5fa', audio: '#ff66cc', bgm: '#4ade80', cue: '#4ade80', bgs: '#fada5e', wildlife: '#22d3ee' };
      const stuckToBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 16;
      const prevScrollTop = panel.scrollTop;
      const filter = window.__debugLogFilter || 'all';
      const subFilter = window.__debugLogSubFilter || 'all';
      _ensureDebugSubFilterTabs(filter);
      panel.innerHTML = _debugEntriesForFilter(filter, subFilter)
        .map(e => {
          const c = COLOR[e.lvl] || COLOR.info;
          const safe = e.msg.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/fallback/gi, m => `<span style="color:#f87171;font-weight:bold">${m}</span>`);
          return `<span style="color:#6b7280">[${e.t}]</span> <span style="color:${c}">${safe}</span>`;
        }).join('\n');
      panel.scrollTop = stuckToBottom ? panel.scrollHeight : prevScrollTop;
    }

    // The primary tab click is owned by game.js. Reset the subordinate choice
    // synchronously before that handler runs; game.js then changes the primary
    // filter and performs the render using the fresh All-subcategory state.
    document.addEventListener('click', function (event) {
      const button = event.target.closest('#debugFilterTabs [data-filter]');
      if (!button) return;
      window.__debugLogSubFilter = 'all';
    }, true);

    window._renderDebugPanel = _renderDebugPanel;
    window.__debugLogMatchesFilter = function (entry, filter) {
      const activeFilter = filter || window.__debugLogFilter || 'all';
      const activeSubFilter = activeFilter === (window.__debugLogFilter || 'all')
        ? (window.__debugLogSubFilter || 'all')
        : 'all';
      return _matchesDebugFilter(entry, activeFilter)
        && _matchesDebugSubFilter(entry, activeFilter, activeSubFilter);
    };
    window.__debugLogEntriesForCurrentFilter = function () {
      return _debugEntriesForFilter(window.__debugLogFilter || 'all', window.__debugLogSubFilter || 'all');
    }; // Used by any copy/export code that wants the exact same visible slice, including the short All view.
    window.__debugLogHistoryMax = DEBUG_HISTORY_MAX; // Used for optional dev inspection of the retained-session cap.

    window.addEventListener('error', function (event) {
      window.__farmLog(`${event.message} @ ${event.filename || 'inline'}:${event.lineno || '?'}:${event.colno || '?'}`, 'error');
    });
    window.addEventListener('unhandledrejection', function (event) {
      window.__farmLog(event.reason && event.reason.stack ? event.reason.stack : String(event.reason), 'promise');
    });
    window.__farmLog('early debug hooks installed');