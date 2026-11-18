'use strict';

// Build-only transforms for the manually published Friends edition.
// The ordinary desktop package stays unchanged in git and in main's CI.
const fs = require('node:fs');
const path = require('node:path');

const FEED_URL = 'https://raw.githubusercontent.com/Oolnokk/HobunjiHollowUnity/friends-update-feed/';
const RELEASES_URL = 'https://github.com/Oolnokk/HobunjiHollowUnity/releases/download/';
const PRODUCT_NAME = 'Hobunji Hollow Tester';
const APP_ID = 'com.oolnokk.hobunjihollow.tester';

function checkedVersion(version) {
  if (!/^0\.2\.[1-9]\d*$/.test(String(version || ''))) {
    throw new Error('Friends version must be 0.2.<positive GitHub workflow run number>.');
  }
  return version;
}

function installerName(version) {
  return 'Hobunji-Hollow-Tester-Setup-' + checkedVersion(version) + '.exe';
}

function configureFriendsPackage(manifest, version) {
  checkedVersion(version);
  const configured = JSON.parse(JSON.stringify(manifest)); // Build-only copy; never mutate the caller's manifest.
  configured.version = version;
  configured.productName = PRODUCT_NAME; // Electron uses this to isolate its local profile and runtime edition.
  configured.build.appId = APP_ID;
  configured.build.productName = PRODUCT_NAME;
  configured.build.win.artifactName = 'Hobunji-Hollow-Tester-Setup-' + '$' + '{version}.' + '$' + '{ext}';
  configured.build.publish = [{ provider: 'generic', url: FEED_URL }];
  return configured;
}

function makeFriendsFeed(metadata, version) {
  checkedVersion(version);
  if (!metadata.split(/\r?\n/).some(line => line.trim() === 'version: ' + version)) {
    throw new Error('Updater metadata does not match Friends build version ' + version);
  }
  if (!metadata.includes('sha512:')) throw new Error('Updater metadata has no file checksum');
  const filename = installerName(version); // Must match electron-builder's exact artifact name.
  const assetUrl = RELEASES_URL + 'friends-v' + version + '/' + filename; // Immutable GitHub release asset URL.
  const counts = { url: 0, path: 0 }; // Verify both current and legacy electron-updater file references.
  const rewritten = metadata.replace(/^([ \t]*(?:-[ \t]*)?(url|path):[ \t]*)([^\r\n]+)$/gm,
    (match, prefix, field, value) => {
      if (value.trim() !== filename) return match;
      counts[field]++;
      return prefix + assetUrl;
    });
  if (counts.url !== 1 || counts.path !== 1) {
    throw new Error('Expected exactly one Friends installer URL and legacy path: ' + JSON.stringify(counts));
  }
  return rewritten;
}

function runCli(args) {
  const [command, version, filename] = args; // Passed by the manual friends workflow only.
  checkedVersion(version);
  if (command === 'configure') {
    const packageFile = path.join(__dirname, '..', 'desktop', 'package.json'); // Run inside a disposable CI checkout.
    const manifest = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    fs.writeFileSync(packageFile, JSON.stringify(configureFriendsPackage(manifest, version), null, 2) + '\n');
  } else if (command === 'feed') {
    if (!filename) throw new Error('feed requires the local latest.yml filename');
    const metadataFile = path.resolve(filename); // Already generated and downloaded update metadata.
    fs.writeFileSync(metadataFile, makeFriendsFeed(fs.readFileSync(metadataFile, 'utf8'), version));
  } else {
    throw new Error('Usage: node scripts/desktop-friends-build.js configure|feed <version> [latest.yml]');
  }
}

if (require.main === module) {
  try { runCli(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { FEED_URL, RELEASES_URL, PRODUCT_NAME, APP_ID, checkedVersion, installerName, configureFriendsPackage, makeFriendsFeed };
