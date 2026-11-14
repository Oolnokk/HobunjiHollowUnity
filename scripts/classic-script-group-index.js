'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..'); // Resolves the shipped docs tree.
const GROUP_TAG = /<script src="js\/bootstrap\/classic-script-group-loader\.js\?v=[A-Za-z0-9_-]+" data-classic-group="([a-z0-9-]+)"><\/script>/g;

function expandClassicScriptGroups(page = fs.readFileSync(path.join(ROOT, 'docs/index.html'), 'utf8')) {
  return page.replace(GROUP_TAG, (_, group) => {
    const sourcePath = path.join(ROOT, 'docs/js/bootstrap/classic-groups', group + '.js'); // Real versioned module list.
    const writes = []; // Markup inserted by the production parser-ordered manifest.
    vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), {
      document: { readyState: 'loading', write: html => writes.push(html) },
    }, { filename: sourcePath });
    return writes.join('');
  });
}

module.exports = { expandClassicScriptGroups };
