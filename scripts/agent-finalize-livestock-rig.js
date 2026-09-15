'use strict';

const fs = require('node:fs');

function replaceOnce(path, before, after, label) {
  const source = fs.readFileSync(path, 'utf8');
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: expected source block not found in ${path}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: source block is not unique in ${path}`);
  fs.writeFileSync(path, source.slice(0, first) + after + source.slice(first + before.length));
}

// The final values now live in attachment-rig-profiles.js itself, so the old
// post-master sidecar loader must disappear rather than issuing a 404 on every
// gameplay boot.
const loaderPath = 'docs/js/character-action-locks.js';
replaceOnce(
  loaderPath,
  "  const authoredLivestockRig = new URL('../config/attachment-rig-livestock-authored.js?v=20260915riglivestock1', base).href; // Promotes the latest Puktuk/Vorg-ass Rig Coordinates export before creature/game initialization.\n",
  '',
  'obsolete authored livestock sidecar loader',
);
replaceOnce(
  loaderPath,
  '  document.write(`<script src="${authoredLivestockRig}"><\\/script><script src="${chathead}"><\\/script>',
  '  document.write(`<script src="${chathead}"><\\/script>',
  'obsolete authored livestock sidecar script tag',
);

const workflow = `name: Voorg-Ass regression

on:
  push:
    paths:
      - 'docs/config/attachment-rig-profiles.js'
      - 'docs/js/creature-genetics.js'
      - 'docs/js/creature-genetics-render.js'
      - 'docs/js/animal-chathead-frame.js'
      - 'docs/js/character-action-locks.js'
      - 'docs/assets/creaturesprites/puktuk_eye.png'
      - 'docs/assets/creaturesprites/puktuk_blink.png'
      - 'docs/tools/animation-author/index.html'
      - 'docs/config/loot/loot-pools.json'
      - 'scripts/test-attachment-rig-master.js'
      - 'scripts/test-puktuk-species.js'
      - 'scripts/test-voorg-ass-species.js'
      - 'scripts/test-new-creature-rig-coordinates.js'
      - 'scripts/test-puktuk-voorg-canonical-rig.js'
      - '.github/workflows/voorg-ass-regression.yml'
  pull_request:
    paths:
      - 'docs/config/attachment-rig-profiles.js'
      - 'docs/js/creature-genetics.js'
      - 'docs/js/creature-genetics-render.js'
      - 'docs/js/animal-chathead-frame.js'
      - 'docs/js/character-action-locks.js'
      - 'docs/assets/creaturesprites/puktuk_eye.png'
      - 'docs/assets/creaturesprites/puktuk_blink.png'
      - 'docs/tools/animation-author/index.html'
      - 'docs/config/loot/loot-pools.json'
      - 'scripts/test-attachment-rig-master.js'
      - 'scripts/test-puktuk-species.js'
      - 'scripts/test-voorg-ass-species.js'
      - 'scripts/test-new-creature-rig-coordinates.js'
      - 'scripts/test-puktuk-voorg-canonical-rig.js'
      - '.github/workflows/voorg-ass-regression.yml'

permissions:
  contents: read

jobs:
  regression:
    runs-on: ubuntu-latest
    steps:
      - name: Check out branch
        uses: actions/checkout@v4
      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Syntax check creature genetics
        run: node --check docs/js/creature-genetics.js
      - name: Syntax check Rig Coordinates helper
        run: node --check docs/js/animal-chathead-frame.js
      - name: Syntax check canonical attachment rig
        run: node --check docs/config/attachment-rig-profiles.js
      - name: Validate loot JSON
        run: node -e "JSON.parse(require('node:fs').readFileSync('docs/config/loot/loot-pools.json', 'utf8'))"
      - name: Test attachment rig master
        run: node scripts/test-attachment-rig-master.js
      - name: Test Puktuk integration
        run: node scripts/test-puktuk-species.js
      - name: Test Voorg-Ass integration
        run: node scripts/test-voorg-ass-species.js
      - name: Test new livestock Rig Coordinates integration
        run: node scripts/test-new-creature-rig-coordinates.js
      - name: Test canonical livestock rig and Puktuk eyes
        run: node scripts/test-puktuk-voorg-canonical-rig.js
`;
fs.writeFileSync('.github/workflows/voorg-ass-regression.yml', workflow);

// Remove the one-shot migration machinery from the final PR. GitHub has
// already loaded this workflow definition for the current run.
fs.unlinkSync('.github/workflows/agent-finalize-livestock-rig.yml');
fs.unlinkSync('scripts/agent-finalize-livestock-rig.js');

console.log('Cleaned stale sidecar loader, refreshed regression coverage, and removed one-shot migration files.');
