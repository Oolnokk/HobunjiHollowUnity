(() => {
  'use strict';
  // Parser-blocking classic script. Must execute at its original position in index.html.
  const tag = document.currentScript; // The tag supplying the group name.
  const group = tag?.getAttribute('data-classic-group'); // Selects an independently owned manifest.
  if (!group || !/^[a-z][a-z0-9-]*$/.test(group)) throw new Error('Invalid classic script group');
  if (document.readyState !== 'loading') throw new Error('Classic script groups must load while HTML is parsing');

  // Register once for every group; manifest fetch/parse failures would otherwise leave
  // the page running with missing systems and no usable explanation on mobile.
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && !window.HobunjiClassicScriptGroups) {
    const failedGroups = []; // Exposed for the in-game debugger; updated only on manifest failures.
    window.HobunjiClassicScriptGroups = { failedGroups }; // One diagnostic record shared by all group loader invocations.
    window.addEventListener('error', event => {
      const source = event?.target?.src || event?.filename || ''; // URL of a failed resource or script evaluation.
      const failed = String(source).match(/(?:^|\/)js\/bootstrap\/classic-groups\/([a-z][a-z0-9-]*)\.js(?:[?#]|$)/);
      if (!failed || failedGroups.includes(failed[1])) return;
      failedGroups.push(failed[1]);
      if (!document.body || typeof document.createElement !== 'function') return;
      let notice = document.getElementById('classicScriptLoadFailure'); // Reuse one visible error notice for all failed groups.
      if (!notice) {
        notice = document.createElement('div');
        notice.id = 'classicScriptLoadFailure';
        notice.setAttribute('role', 'alert');
        notice.style.cssText = 'position:fixed;top:56px;left:10px;right:10px;z-index:2147483647;padding:9px 12px;'
          + 'background:rgba(80,12,12,.94);color:white;font:600 14px/1.4 system-ui,sans-serif;'
          + 'border-radius:6px;pointer-events:none';
        document.body.appendChild(notice);
      }
      notice.textContent = 'Game startup scripts failed (' + failedGroups.join(', ')
        + '). Refresh this page; if it persists, report these group names.';
    }, true);
  }

  // Fetch each tiny manifest fresh; its component URLs retain their own cache-bust versions.
  const manifestUrl = 'js/bootstrap/classic-groups/' + group + '.js?load=' + Date.now(); // Per-navigation manifest URL.
  document.write('<script src="' + manifestUrl + '"><\/script>');
})();
