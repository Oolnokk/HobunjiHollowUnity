// Boots the exact readable Debris-ifier V50 source and then exposes its dev API.
// index.html still references the historical split-script shell; this first entry
// deliberately owns the real runtime so existing tool links keep working unchanged.
(() => {
  'use strict';

  const debug = document.getElementById('debug');
  const fail = message => {
    if (debug) debug.textContent = `Debris-ifier bootstrap: FAILED — ${message}`;
    console.error('[Debris-ifier bootstrap]', message);
  };

  const source = document.createElement('script');
  source.src = 'debrisifier-v50-source.js';
  source.onerror = () => fail('readable V50 source did not load.');
  source.onload = () => {
    const api = document.createElement('script');
    api.src = 'debrisifier-v50-api.js';
    api.onerror = () => fail('V50 dev API did not load.');
    document.head.appendChild(api);
  };
  document.head.appendChild(source);
})();
