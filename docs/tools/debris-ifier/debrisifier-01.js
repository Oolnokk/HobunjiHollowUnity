// Bootstraps the preserved V50 runtime while the Tool Hub integration still uses the original split-script shell.
(() => {
  const script = document.createElement('script'); // Used to load the integrity-checked V50 runtime reconstruction after Three.js dependencies are ready.
  script.src = 'debrisifier-runtime-loader.js';
  script.onerror = () => {
    const debug = document.getElementById('debug');
    if (debug) debug.textContent = 'Debris-ifier bootstrap: FAILED — runtime loader did not load.';
  };
  document.head.appendChild(script);
})();
