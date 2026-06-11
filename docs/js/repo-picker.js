// RepoPicker — shared repo-file browser for all dev-tool editors.
// Add via: <script src="../../js/repo-picker.js"></script>  (adjust depth as needed)
// API:
//   const rp = new RepoPicker({ docsBase: '../../' });
//   const el = rp.makePicker({ category, filter, label, fetchAs, onLoad, diskAccept, showDisk });
//   someAnchor.before(el);   // or .after(), .replaceWith(), .appendChild(), etc.
//
// category  — key in docs/assets/index.json (models | wallRecipes | npcDatabases | maps | housePieces)
// filter    — optional (entry) => bool
// label     — button text (default '☷ Repo')
// fetchAs   — 'arraybuffer' | 'text' | 'json'  (default: arraybuffer for models, json otherwise)
// onLoad    — (entry, data) => {}  called with the loaded file
// diskAccept— accept string for the fallback file input
// showDisk  — show "↑ Upload" fallback button (default true)
(function (root) {
  'use strict';

  const CSS_ID = 'rp-global-style';
  const CSS = `
.rp-wrap{display:inline-flex;align-items:center;gap:5px;position:relative;flex-wrap:wrap}
.rp-btn{font:inherit;font-size:12px;font-weight:700;padding:6px 11px;border-radius:8px;cursor:pointer;border:1px solid rgba(106,167,255,.38);background:rgba(106,167,255,.14);color:#edf5ff;transition:background .1s;white-space:nowrap}
.rp-btn:hover{background:rgba(106,167,255,.26)}
.rp-disk{font:inherit;font-size:12px;padding:6px 11px;border-radius:8px;cursor:pointer;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#9fb4cf;transition:background .1s;white-space:nowrap}
.rp-disk:hover{background:rgba(255,255,255,.12)}
.rp-panel{position:absolute;top:calc(100% + 5px);left:0;min-width:290px;max-width:420px;background:#0d1825;border:1px solid rgba(106,167,255,.28);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.6);z-index:9999;overflow:hidden}
.rp-search{display:block;width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:none;border-bottom:1px solid rgba(255,255,255,.1);color:#edf5ff;font:inherit;font-size:12px;padding:8px 11px;outline:none}
.rp-search::placeholder{color:#9fb4cf}
.rp-list{max-height:260px;overflow-y:auto;padding:4px 0}
.rp-list::-webkit-scrollbar{width:5px}.rp-list::-webkit-scrollbar-track{background:rgba(0,0,0,.2)}.rp-list::-webkit-scrollbar-thumb{background:rgba(106,167,255,.25);border-radius:3px}
.rp-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 11px;cursor:pointer;font-size:12px;color:#edf5ff;border-bottom:1px solid rgba(255,255,255,.04);transition:background .08s}
.rp-item:last-child{border-bottom:none}
.rp-item:hover{background:rgba(106,167,255,.15)}
.rp-item-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rp-item-tag{font-size:10px;color:#9fb4cf;border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:2px 7px;white-space:nowrap;flex-shrink:0}
.rp-msg{padding:12px 11px;font-size:12px;color:#9fb4cf;text-align:center}
.rp-loading-spinner{display:inline-block;width:12px;height:12px;border:2px solid rgba(106,167,255,.25);border-top-color:#6aa7ff;border-radius:50%;animation:rp-spin .6s linear infinite;margin-right:6px;vertical-align:middle}
@keyframes rp-spin{to{transform:rotate(360deg)}}
`;

  function injectStyles() {
    if (document.getElementById(CSS_ID)) return;
    const s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function RepoPicker(opts) {
    opts = opts || {};
    this._base = String(opts.docsBase || '../../').replace(/\/?$/, '/');
    this._indexUrl = this._base + 'assets/index.json';
    this._indexCache = null;
    this._indexPromise = null;
    injectStyles();
  }

  RepoPicker.prototype._loadIndex = function () {
    if (this._indexCache) return Promise.resolve(this._indexCache);
    if (this._indexPromise) return this._indexPromise;
    const self = this;
    self._indexPromise = fetch(self._indexUrl)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { self._indexCache = d; self._indexPromise = null; return d; })
      .catch(function (e) { self._indexPromise = null; throw e; });
    return self._indexPromise;
  };

  RepoPicker.prototype.makePicker = function (opts) {
    opts = opts || {};
    const self     = this;
    const category = opts.category  || 'models';
    const filter   = opts.filter    || null;
    const label    = opts.label     || '☷ Repo';
    const onLoad   = opts.onLoad    || function () {};
    const showDisk = opts.showDisk  !== false;
    const fetchAs  = opts.fetchAs   || (category === 'models' ? 'arraybuffer' : 'json');
    const diskAccept = opts.diskAccept || (fetchAs === 'arraybuffer' ? '.glb,.gltf' : '.json,application/json');

    // Container
    const wrap = document.createElement('div');
    wrap.className = 'rp-wrap';

    // Main browse button
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rp-btn';
    btn.textContent = label;
    wrap.appendChild(btn);

    // Upload-from-disk fallback
    if (showDisk) {
      const diskBtn = document.createElement('button');
      diskBtn.type = 'button';
      diskBtn.className = 'rp-disk';
      diskBtn.textContent = '↑ Upload';
      const diskInput = document.createElement('input');
      diskInput.type = 'file';
      diskInput.accept = diskAccept;
      diskInput.style.display = 'none';
      diskBtn.addEventListener('click', function () { diskInput.click(); });
      diskInput.addEventListener('change', async function () {
        const f = diskInput.files && diskInput.files[0];
        if (!f) return;
        try {
          let content;
          if (fetchAs === 'arraybuffer') content = await f.arrayBuffer();
          else if (fetchAs === 'text')   content = await f.text();
          else                           content = JSON.parse(await f.text());
          onLoad({ name: f.name, path: f.name, category: 'upload' }, content);
        } catch (e) { console.error('RepoPicker upload error:', e); }
        diskInput.value = '';
      });
      wrap.appendChild(diskBtn);
      wrap.appendChild(diskInput);
    }

    // Panel management
    let panel = null;

    function closePanel() {
      if (panel) { panel.remove(); panel = null; }
    }

    function buildPanel(entries) {
      panel = document.createElement('div');
      panel.className = 'rp-panel';

      const search = document.createElement('input');
      search.type = 'search';
      search.className = 'rp-search';
      search.placeholder = 'Search…';
      panel.appendChild(search);

      const list = document.createElement('div');
      list.className = 'rp-list';
      panel.appendChild(list);

      function renderList(q) {
        const filtered = q
          ? entries.filter(function (e) {
              return (e.name || '').toLowerCase().includes(q) ||
                     (e.category || '').toLowerCase().includes(q);
            })
          : entries;
        list.innerHTML = '';
        if (!filtered.length) {
          const em = document.createElement('div');
          em.className = 'rp-msg';
          em.textContent = 'No files match.';
          list.appendChild(em);
          return;
        }
        filtered.forEach(function (entry) {
          const item = document.createElement('div');
          item.className = 'rp-item';

          const nm = document.createElement('span');
          nm.className = 'rp-item-name';
          nm.textContent = entry.name;
          item.appendChild(nm);

          if (entry.category) {
            const tg = document.createElement('span');
            tg.className = 'rp-item-tag';
            tg.textContent = entry.category;
            item.appendChild(tg);
          }

          item.addEventListener('click', async function () {
            closePanel();
            const url = self._base + entry.path;
            try {
              const r = await fetch(url);
              if (!r.ok) throw new Error('HTTP ' + r.status + ' — ' + url);
              let content;
              if (fetchAs === 'arraybuffer')    content = await r.arrayBuffer();
              else if (fetchAs === 'text')      content = await r.text();
              else                              content = await r.json();
              onLoad(entry, content);
            } catch (e) {
              console.error('RepoPicker fetch error:', url, e);
              alert('Could not load: ' + entry.name + '\n' + e.message);
            }
          });

          list.appendChild(item);
        });
      }

      search.addEventListener('input', function () { renderList(search.value.toLowerCase()); });
      renderList('');
      // Auto-focus search
      setTimeout(function () { search.focus(); }, 30);
      return panel;
    }

    // Toggle panel on button click
    btn.addEventListener('click', async function (e) {
      e.stopPropagation();
      if (panel) { closePanel(); return; }

      // Show loading placeholder
      const loading = document.createElement('div');
      loading.className = 'rp-panel';
      const lbl = document.createElement('div');
      lbl.className = 'rp-msg';
      lbl.innerHTML = '<span class="rp-loading-spinner"></span>Loading index…';
      loading.appendChild(lbl);
      wrap.appendChild(loading);

      try {
        const index = await self._loadIndex();
        loading.remove();
        let entries = index[category] || [];
        if (filter) entries = entries.filter(filter);
        wrap.appendChild(buildPanel(entries));
      } catch (err) {
        loading.remove();
        alert('Could not load asset index: ' + err.message);
      }
    });

    // Close on outside click
    document.addEventListener('click', function (e) {
      if (panel && !wrap.contains(e.target)) closePanel();
    });

    return wrap;
  };

  root.RepoPicker = RepoPicker;
}(window));
