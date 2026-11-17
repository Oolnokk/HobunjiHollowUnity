'use strict';

const path = require('node:path');

// Stable origin means Chromium keeps localStorage and IndexedDB between app launches.
const GAME_SCHEME = 'hobunji';
const GAME_HOST = 'game';
const GAME_URL = GAME_SCHEME + '://' + GAME_HOST + '/index.html';

// Desktop-installed copies of the original game's exact Three.js r128 scripts.
const VENDOR_PATHS = Object.freeze({
  '/__desktop_vendor__/three.min.js': 'three.min.js',
  '/__desktop_vendor__/TransformControls.js': 'TransformControls.js',
});
const REPLACEMENTS = Object.freeze([
  ['https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', '/__desktop_vendor__/three.min.js'],
  ['https://unpkg.com/three@0.128.0/examples/js/controls/TransformControls.js', '/__desktop_vendor__/TransformControls.js'],
]);

function isGameUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === GAME_SCHEME + ':' && url.hostname === GAME_HOST &&
      !url.port && !url.username && !url.password;
  } catch { return false; }
}

function getGameAsset(requestUrl, { gameRoot, vendorRoot }) {
  if (!isGameUrl(requestUrl)) return null;
  // WHATWG URL() normalizes dot segments; inspect the raw input before normalization.
  const rawPath = String(requestUrl).split(/[?#]/, 1)[0].replace(/^hobunji:\/\/[^/]+/i, '');
  if (/(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(rawPath)) return null;
  let url, pathname;
  try {
    url = new URL(requestUrl);
    pathname = decodeURIComponent(url.pathname);
  } catch { return null; }
  if (/%(?:2f|5c|00)/i.test(url.pathname) || /[\\\0]/.test(pathname)) return null;
  const parts = pathname.split('/').filter(Boolean);
  if (parts.some(part => part === '.' || part === '..' || part.startsWith('.'))) return null;
  if (parts[0] === '__desktop_vendor__') {
    const filename = VENDOR_PATHS[pathname];
    return filename ? { kind: 'vendor', file: path.join(vendorRoot, filename) } : null;
  }
  const root = path.resolve(gameRoot);
  const file = path.resolve(root, ...(parts.length ? parts : ['index.html']));
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  return { kind: file.endsWith('.html') ? 'html' : 'static', file };
}

function localizeGameHtml(html) {
  let result = String(html);
  for (const [remote, local] of REPLACEMENTS) result = result.replaceAll(remote, local);
  return result;
}

module.exports = { GAME_SCHEME, GAME_URL, getGameAsset, isGameUrl, localizeGameHtml };
