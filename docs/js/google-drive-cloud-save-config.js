// Google Drive Cloud Save public client configuration.
// These values are intentionally browser-visible; restrict them to the game's deployed origins in Google Cloud Console.
window.HobunjiGoogleDriveConfig = Object.assign({
  clientId: '', // Used by Google Identity Services to request Drive access tokens.
  apiKey: '', // Used by Google Picker; restrict this key to the Picker/Drive APIs and approved HTTP referrers.
  appId: '', // Google Cloud project number used by Google Picker's setAppId().
}, window.HobunjiGoogleDriveConfig || {});
