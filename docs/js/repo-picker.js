// RepoPicker — shared repo-file browser for Hobunji development tools.
(function (root) {
  'use strict';

  const STYLE_ID = 'rp-global-style';
  const STYLE = `
.rp-wrap{display:inline-flex;align-items:center;gap:5px;position:relative;flex-wrap:wrap}
.rp-btn,.rp-disk{font:inherit;font-size:12px;padding:6px 11px;border-radius:8px;cursor:pointer;white-space:nowrap}
.rp-btn{font-weight:700;border:1px solid rgba(106,167,255,.38);background:rgba(106,167,255,.14);color:#edf5ff}
.rp-btn:hover{background:rgba(106,167,255,.26)}
.rp-disk{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#9fb4cf}
.rp-disk:hover{background:rgba(255,255,255,.12)}
.rp-panel{position:absolute;top:calc(100% + 5px);left:0;min-width:290px;max-width:420px;background:#0d1825;border:1px solid rgba(106,167,255,.28);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.6);z-index:9999;overflow:hidden}
.rp-search{display:block;width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:0;border-bottom:1px solid rgba(255,255,255,.1);color:#edf5ff;font:inherit;font-size:12px;padding:8px 11px;outline:0}
.rp-search::placeholder{color:#9fb4cf}
.rp-list{max-height:260px;overflow-y:auto;padding:4px 0}
.rp-list::-webkit-scrollbar{width:5px}.rp-list::-webkit-scrollbar-track{background:rgba(0,0,0,.2)}.rp-list::-webkit-scrollbar-thumb{background:rgba(106,167,255,.25);border-radius:3px}
.rp-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 11px;cursor:pointer;font-size:12px;color:#edf5ff;border-bottom:1px solid rgba(255,255,255,.04)}
.rp-item:hover{background:rgba(106,167,255,.15)}.rp-item:last-child{border-bottom:0}
.rp-item-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rp-item-tag{font-size:10px;color:#9fb4cf;border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:2px 7px;white-space:nowrap;flex-shrink:0}
.rp-msg{padding:12px 11px;font-size:12px;color:#9fb4cf;text-align:center}
.rp-loading-spinner{display:inline-block;width:12px;height:12px;border:2px solid rgba(106,167,255,.25);border-top-color:#6aa7ff;border-radius:50%;animation:rp-spin .6s linear infinite;margin-right:6px;vertical-align:middle}
@keyframes rp-spin{to{transform:rotate(360deg)}}`;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  function RepoPicker(options) {
    const opts = options || {};
    this._base = String(opts.docsBase || '../../').replace(/\/?$/, '/');
    this._indexUrl = this._base + 'assets/index.json';
    this._indexCache = null;
    this._indexPromise = null;
    injectStyles();
  }

  RepoPicker.prototype._loadIndex = function () {
    if (this._indexCache) return Promise.resolve(this._indexCache);
    if (this._indexPromise) return this._indexPromise;

    this._indexPromise = fetch(this._indexUrl)
      .then(response => {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(index => {
        this._indexCache = index;
        this._indexPromise = null;
        return index;
      })
      .catch(error => {
        this._indexPromise = null;
        throw error;
      });

    return this._indexPromise;
  };

  RepoPicker.prototype.makePicker = function (options) {
    const opts = options || {};
    const category = opts.category || 'models';
    const filter = typeof opts.filter === 'function' ? opts.filter : null;
    const label = opts.label || '☷ Repo';
    const onLoad = typeof opts.onLoad === 'function' ? opts.onLoad : function () {};
    const showDisk = opts.showDisk !== false;
    const fetchAs = opts.fetchAs || (category === 'models' ? 'arraybuffer' : 'json');
    const diskAccept = opts.diskAccept || (fetchAs === 'arraybuffer'
      ? '.glb,.gltf'
      : '.json,application/json');

    const wrap = document.createElement('div');
    wrap.className = 'rp-wrap';

    const browseButton = document.createElement('button');
    browseButton.type = 'button';
    browseButton.className = 'rp-btn';
    browseButton.textContent = label;
    wrap.appendChild(browseButton);

    if (showDisk) {
      const uploadButton = document.createElement('button');
      uploadButton.type = 'button';
      uploadButton.className = 'rp-disk';
      uploadButton.textContent = '↑ Upload';

      const input = document.createElement('input');
      input.type = 'file';
      input.accept = diskAccept;
      input.style.display = 'none';

      uploadButton.addEventListener('click', () => input.click());
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        try {
          let content;
          if (fetchAs === 'arraybuffer') content = await file.arrayBuffer();
          else if (fetchAs === 'text') content = await file.text();
          else content = JSON.parse(await file.text());
          await onLoad({ name: file.name, path: file.name, category: 'upload' }, content);
        } catch (error) {
          console.error('RepoPicker upload error:', error);
          alert('Could not load uploaded file: ' + error.message);
        }
        input.value = '';
      });

      wrap.append(uploadButton, input);
    }

    let panel = null;

    const closePanel = () => {
      if (!panel) return;
      panel.remove();
      panel = null;
    };

    const readResponse = async response => {
      if (fetchAs === 'arraybuffer') return response.arrayBuffer();
      if (fetchAs === 'text') return response.text();
      return response.json();
    };

    const buildPanel = entries => {
      panel = document.createElement('div');
      panel.className = 'rp-panel';

      const search = document.createElement('input');
      search.type = 'search';
      search.className = 'rp-search';
      search.placeholder = 'Search…';

      const list = document.createElement('div');
      list.className = 'rp-list';
      panel.append(search, list);

      const render = rawQuery => {
        const query = String(rawQuery || '').toLowerCase();
        const visible = query
          ? entries.filter(entry =>
              String(entry.name || '').toLowerCase().includes(query) ||
              String(entry.category || '').toLowerCase().includes(query))
          : entries;

        list.replaceChildren();
        if (!visible.length) {
          const empty = document.createElement('div');
          empty.className = 'rp-msg';
          empty.textContent = 'No files match.';
          list.appendChild(empty);
          return;
        }

        for (const entry of visible) {
          const item = document.createElement('div');
          item.className = 'rp-item';

          const name = document.createElement('span');
          name.className = 'rp-item-name';
          name.textContent = entry.name || entry.path || 'Unnamed';

          item.appendChild(name);
          if (entry.category) {
            const tag = document.createElement('span');
            tag.className = 'rp-item-tag';
            tag.textContent = entry.category;
            item.appendChild(tag);
          }

          item.addEventListener('click', async () => {
            closePanel();
            const url = this._base + entry.path;
            try {
              const response = await fetch(url);
              if (!response.ok) throw new Error('HTTP ' + response.status + ' — ' + url);
              await onLoad(entry, await readResponse(response));
            } catch (error) {
              console.error('RepoPicker fetch error:', url, error);
              alert('Could not load: ' + (entry.name || entry.path) + '\n' + error.message);
            }
          });
          list.appendChild(item);
        }
      };

      search.addEventListener('input', () => render(search.value));
      render('');
      setTimeout(() => search.focus(), 30);
      return panel;
    };

    browseButton.addEventListener('click', async event => {
      event.stopPropagation();
      if (panel) {
        closePanel();
        return;
      }

      const loading = document.createElement('div');
      loading.className = 'rp-panel';
      loading.innerHTML = '<div class="rp-msg"><span class="rp-loading-spinner"></span>Loading index…</div>';
      wrap.appendChild(loading);

      try {
        const index = await this._loadIndex();
        loading.remove();
        let entries = Array.isArray(index[category]) ? index[category] : [];
        if (filter) entries = entries.filter(filter);
        wrap.appendChild(buildPanel(entries));
      } catch (error) {
        loading.remove();
        alert('Could not load asset index: ' + error.message);
      }
    });

    document.addEventListener('click', event => {
      if (panel && !wrap.contains(event.target)) closePanel();
    });

    return wrap;
  };

  root.RepoPicker = RepoPicker;
}(window));

(function loadHousePieceAuthorEnhancements() {
  const path = location.pathname.replace(/\/+$/, '');
  if (!/\/tools\/house-piece-author(?:\/index\.html)?$/.test(path)) return;
  if (document.querySelector('script[data-house-piece-author-repo-enhancements]')) return;

  const current = document.currentScript;
  const source = current?.src
    ? new URL('house-piece-author-repo-enhancements.js', current.src).href
    : '../../js/house-piece-author-repo-enhancements.js';

  const script = document.createElement('script');
  script.src = source;
  script.async = false;
  script.dataset.housePieceAuthorRepoEnhancements = '1';
  script.addEventListener('error', () => {
    console.error('Could not load house-piece-author-repo-enhancements.js');
  });
  document.head.appendChild(script);
}());

(function loadCharacterStudioAnimalAppearance() {
  const path = location.pathname.replace(/\/+$/, ''); // Used to keep this enhancement scoped to Character Studio instead of every RepoPicker consumer.
  if (!/\/tools\/character-studio(?:\/index\.html)?$/.test(path)) return;
  if (document.querySelector('script[data-character-studio-animal-appearance]')) return;

  const current = document.currentScript; // Resolves every animal/fey module beside repo-picker.js regardless of hosting prefix/commit URL.
  const moduleUrl = (name, version) => current?.src ? new URL(`${name}?v=${version}`, current.src).href : `../../js/${name}?v=${version}`;
  const headwearSource = moduleUrl('animal-npc-headwear.js', '20260905feyhat1');
  const bridgeSource = moduleUrl('animal-chathead-frame.js', '20260905feyhat1');
  const source = moduleUrl('character-studio-animal-appearance.js', '20260905animalnpc1');
  const extrasSource = moduleUrl('character-studio-animal-fey-extras.js', '20260905feyhat1');

  function appendModule(src, dataKey, errorLabel) {
    if (document.querySelector(`script[data-${dataKey}]`)) return;
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.setAttribute(`data-${dataKey}`, '1');
    script.addEventListener('error', () => console.error(`Could not load ${errorLabel}`));
    document.head.appendChild(script);
  }

  appendModule(headwearSource, 'character-studio-animal-headwear', 'animal-npc-headwear.js for Character Studio');
  appendModule(bridgeSource, 'character-studio-animal-profile-bridge', 'animal-chathead-frame.js for Character Studio');
  appendModule(source, 'character-studio-animal-appearance', 'character-studio-animal-appearance.js');
  appendModule(extrasSource, 'character-studio-animal-fey-extras', 'character-studio-animal-fey-extras.js');
}());
