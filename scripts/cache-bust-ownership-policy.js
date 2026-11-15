'use strict';

// Classic group manifests are loaded by the parser with ?load=Date.now() on
// every navigation. Their own ?v= tokens are intentionally absent; the child
// modules listed inside each manifest still require independent version bumps.
function isNavigationFreshClassicManifest(file) {
  return /^docs\/js\/bootstrap\/classic-groups\/[a-z0-9-]+\.js$/.test(String(file || '').replace(/\\/g, '/'));
}

module.exports = { isNavigationFreshClassicManifest };
