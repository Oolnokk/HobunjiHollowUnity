// Google Drive Save public web configuration.
// OAuth client IDs, browser API keys, and Cloud project numbers are public web
// identifiers, not secrets. Real values can be injected before this script via
// window.HOBUNJI_GOOGLE_DRIVE_SAVE_CONFIG or filled in here for a deployment.
(() => {
  'use strict';

  if (window.HobunjiGoogleDriveSaveConfig) return;

  const injected = window.HOBUNJI_GOOGLE_DRIVE_SAVE_CONFIG || {}; // Deployment-provided public Google web configuration read once at startup.
  const config = {
    clientId: String(injected.clientId || ''), // OAuth 2.0 Web Client ID used by Google Identity Services token flow.
    apiKey: String(injected.apiKey || ''), // Browser-restricted Google API key used only by Google Picker.
    appId: String(injected.appId || ''), // Google Cloud project number required by Picker when using the drive.file scope.
    scope: 'https://www.googleapis.com/auth/drive.file', // Narrow non-sensitive per-file scope; never broaden this for save syncing.
    canonicalFileName: 'hobunji-primary-save.json', // Must match FolderSaveV3Canonical so Drive and desktop target one stable logical file.
  }; // Public immutable configuration consumed by the Drive transport and diagnostics.

  config.configured = Boolean(config.clientId && config.apiKey && config.appId); // Drive UI stays disabled/not-configured until all required public identifiers exist.

  window.HobunjiGoogleDriveSaveConfig = Object.freeze(config);
})();
