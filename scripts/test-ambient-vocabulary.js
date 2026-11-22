#!/usr/bin/env node
// Regression coverage for word generation, one-shot floating speech and editor integration.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // Repo root used for fixtures and production script evaluation.
const file = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const config = JSON.parse(file('docs/config/dialogue/ambient-vocabulary.json'));
const profiles = JSON.parse(file('docs/config/dialogue/npc-reaction-profiles.json'));
const window = {};
const context = vm.createContext({
  window,
  fetch: async url => ({ ok: true, status: 200, json: async () => String(url).includes('ambient-vocabulary.json') ? config : profiles }),
}); // Evaluates actual browser modules with their configuration fetches, not a test-only clone.

async function main() {
  vm.runInContext(file('docs/js/ambient-vocabulary-rules.js'), context);
  vm.runInContext(file('docs/js/ambient-vocabulary.js'), context);
  for (let i = 0; i < 12; i++) await Promise.resolve(); // Flush the real module's async fetch and JSON continuations.
  const engine = window.AmbientVocabulary;
  const rules = window.AmbientVocabularyRules;
  assert.equal(engine.getDebug().ready, true, engine.getDebug().error);
  assert.ok(Object.keys(config.lexicon).length >= 30);
  for (const [id, family] of Object.entries(config.families)) {
    assert.ok(profiles.profiles[id], 'Unrecognized existing personality family: ' + id);
    for (const axis of Object.keys(rules.DEFAULT_SLIDERS)) {
      assert.ok(Number.isFinite(family.sliders[axis]), id + ' is missing ' + axis);
    }
  }
  const explicit = {
    enabled: true,
    lexicon: {
      lovely: [{ text: 'pleasant', verbosity: 30, color: 20, formality: 60 }],
      'good to see you': [{ text: 'glad to see you', verbosity: 40, color: 30, formality: 40 }],
    },
    families: { neighborly: { sliders: { frequency: 100, variety: 100 } } },
    characters: { pahu: { sliders: { frequency: 100 }, table: { lovely: ['splendid'], 'good to see you': ['delighted to see you'] } } },
  };
  const assignments = { defaultProfile: 'neighborly', assignments: { pahu: 'neighborly' } };
  assert.equal(engine.rewrite('Lovely, LOVELY!', 'pahu', () => 0, explicit, assignments), 'Splendid, SPLENDID!');
  assert.equal(engine.rewrite('Good to see you, {targetName}! {{playerName}} is lovely.', 'pahu', () => 0, explicit, assignments),
    'Delighted to see you, {targetName}! {{playerName}} is splendid.');
  assert.equal(engine.rewrite('unlovely lovely friendship', 'pahu', () => 0, explicit, assignments),
    'unlovely splendid friendship'); // Only complete words, not substrings.
  assert.equal(engine.rewrite('Lovely', 'player', () => 0, explicit, assignments), 'Lovely');
  assert.equal(engine.rewrite('Lovely', 'player-progression', () => 0, explicit, assignments), 'Lovely');
  assert.equal(engine.rewrite('Lovely', null, () => 0, explicit, assignments), 'Lovely');
  assert.equal(engine.rewrite('Lovely', 'pahu', () => 0.999, {
    ...explicit, characters: { pahu: { sliders: { frequency: 0 }, table: { lovely: ['splendid'] } } },
  }, assignments), 'Lovely'); // Authored fallback is always available.
  const generated = rules.generateTable(config.lexicon, config.families.playful.sliders, 'pahu');
  assert.ok(Object.keys(generated).length >= 25);
  assert.deepEqual(generated, rules.generateTable(config.lexicon, config.families.playful.sliders, 'pahu'));
  assert.ok(rules.rewriteLine('lovely {targetName} song', generated, { frequency: 100, variety: 100 }, () => 0, 'pahu').swaps >= 1);
  const narrow = rules.generateTable(config.lexicon, { verbosity: 10, color: 10, formality: 10, breadth: 0, variety: 0 }, 'pahu');
  assert.ok(Object.keys(narrow).every(key => narrow[key].length <= 1)); // Low variety gives each character a consistent favored synonym.
  const debug = engine.getDebug();
  assert.ok(debug.last && Number.isInteger(debug.last.swaps));
  assert.ok(typeof debug.replacements === 'number');

  const floating = file('docs/js/ambient-dialogue.js');
  const regularTalk = file('docs/js/dialogue-content.js');
  assert.ok(floating.includes('window.AmbientVocabulary?.rewrite?.(originalMessage, options.speakerId)'));
  assert.ok(floating.indexOf('window.AmbientVocabulary?.rewrite?.') < floating.indexOf('const textPart = textPlane(message)'));
  assert.ok(floating.includes('showSocialResponse'));
  assert.ok(!regularTalk.includes('AmbientVocabulary')); // The ordinary Talk renderer never invokes word substitution.

  const tool = file('docs/tools/ambient-dialogue-editor/index.html');
  const editor = file('docs/js/ambient-vocabulary-editor.js');
  assert.ok(tool.includes('ambient-vocabulary-rules.js') && tool.includes('ambient-vocabulary-editor.js'));
  assert.ok(file('docs/index.html').includes('ambient-vocabulary.js'));
  assert.ok(editor.includes("['verbosity', 'Simplicity', 'Verbosity'"));
  assert.ok(editor.includes("['color', 'Technical', 'Colorful'"));
  assert.ok(editor.includes('Generate missing NPC tables'));
  assert.ok(editor.includes('vocabPreviewResult'));
  new Function('window', editor); // Parse actual integration script even without a browser DOM.
  console.log('Ambient vocabulary tests passed: generated tables, grammar boundaries, tokens, world speech integration, ordinary Talk exclusion, mobile editor.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });