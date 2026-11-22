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
      lovely: [{ id: 'pleasant', text: 'pleasant', verbosity: 30, color: 20, formality: 60 },
        { id: 'splendid', text: 'splendid', verbosity: 80, color: 80, formality: 80 }],
      'good to see you': [{ id: 'glad', text: 'glad to see you', verbosity: 40, color: 30, formality: 40 },
        { id: 'delighted', text: 'delighted to see you', verbosity: 90, color: 90, formality: 85 }],
    },
    families: { neighborly: { sliders: { frequency: 100, variety: 100 } } },
    characters: { pahu: { sliders: { frequency: 100 }, selections: { lovely: ['splendid'], 'good to see you': ['delighted'] } } },
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
    ...explicit, characters: { pahu: { sliders: { frequency: 0 }, selections: { lovely: ['splendid'] } } },
  }, assignments), 'Lovely'); // Authored fallback is always available.
  assert.notEqual(JSON.stringify(rules.seedSliders(config.families.playful.sliders, 'pahu')),
    JSON.stringify(rules.seedSliders(config.families.playful.sliders, 'sloomi'))); // Same family, distinct stable individual vocabulary axes.
  assert.deepEqual(rules.seedSliders(config.families.playful.sliders, 'pahu'),
    rules.seedSliders(config.families.playful.sliders, 'pahu')); // Restored sessions do not change a character's vocabulary.
  assert.equal(config.schema, 'hobunji_ambient_vocabulary.v2');
  for (const [word, alternatives] of Object.entries(config.lexicon)) {
    assert.ok(Array.isArray(alternatives) && alternatives.every(entry => typeof entry.id === 'string' && entry.id));
    assert.equal(new Set(alternatives.map(entry => entry.id)).size, alternatives.length, 'Duplicate IDs in ' + word);
  }
  const suggestions = rules.generateSelections(config.lexicon, config.families.playful.sliders, 'pahu');
  assert.ok(Object.keys(suggestions).length >= 15, 'Broad vocabulary must cover numerous source words');
  assert.deepEqual(suggestions, rules.generateSelections(config.lexicon, config.families.playful.sliders, 'pahu'));
  const generated = rules.resolveSelections(config.lexicon, suggestions);
  assert.ok(Object.keys(generated).length >= 15);
  const fullySelected = { lovely: config.lexicon.lovely.map(entry => entry.id) };
  const edited = rules.mergeSelections(suggestions, fullySelected);
  assert.deepEqual(edited.lovely, fullySelected.lovely);
  const disabled = rules.mergeSelections(edited, { lovely: [] });
  assert.deepEqual(disabled.lovely, []);
  assert.equal(rules.resolveSelections(config.lexicon, disabled).lovely, undefined, 'Explicit empty list disables substitutions');
  const canonical = { lovely: [{ id: 'one', text: 'pretty', verbosity: 20, color: 50, formality: 40 },
    { id: 'two', text: 'splendid', verbosity: 80, color: 70, formality: 85 }] };
  const refs = { lovely: ['two'] };
  assert.deepEqual(rules.resolveSelections(canonical, refs).lovely, ['splendid']);
  canonical.lovely[1].text = 'magnificent';
  assert.deepEqual(rules.resolveSelections(canonical, refs).lovely, ['magnificent']); // Editing the master list updates all checked characters without copying alternatives.
  assert.deepEqual(rules.resolveSelections(canonical, { lovely: ['unknown'] }), {}); // Deleted synonyms cannot become ghost replacements.
  assert.deepEqual(rules.migrateLegacyTable(canonical, { lovely: ['magnificent'] }), { lovely: ['two'] });
  assert.equal(rules.rewriteLine('a lovely tune', { lovely: ['amazing','wonderful'] },
    { frequency: 100, variety: 100 }, () => 0, 'pahu').text, 'a wonderful tune'); // a/an agreement.
  assert.equal(rules.rewriteLine('an lovely tune', { lovely: ['amazing','wonderful'] },
    { frequency: 100, variety: 100 }, () => 0, 'pahu').text, 'an amazing tune');
  assert.equal(rules.rewriteLine('a lovely tune', { lovely: ['amazing'] },
    { frequency: 100 }, () => 0, 'pahu').text, 'a lovely tune'); // Invalid article agreement falls back to authored text.
  assert.equal(rules.rewriteLine('lovely {targetName} friend', { lovely: ['nice'], friend: ['pal'] },
    { frequency: 100, variety: 100 }, () => 0, 'pahu').text, 'nice {targetName} pal');
  assert.equal(rules.rewriteLine('lovelier friendship', { lovely: ['nice'], friend: ['pal'] },
    { frequency: 100, variety: 100 }, () => 0, 'pahu').text, 'lovelier friendship'); // No substrings.
  const narrow = rules.generateSelections(config.lexicon,
    { verbosity: 10, color: 10, formality: 10, breadth: 0, variety: 0 }, 'pahu');
  assert.ok(Object.keys(narrow).every(key => narrow[key].length <= 1)); // Consistent speakers choose one synonym per word.
  const debug = engine.getDebug();
  assert.ok(debug.last && Number.isInteger(debug.last.swaps));
  assert.ok(typeof debug.replacements === 'number');

  const floating = file('docs/js/ambient-dialogue.js');
  const regularTalk = file('docs/js/dialogue-content.js');
  assert.ok(floating.includes('window.AmbientVocabulary?.rewrite?.(originalMessage, options.speakerId)'));
  assert.ok(floating.indexOf('window.AmbientVocabulary?.rewrite?.') < floating.indexOf('const textPart = textPlane(message)'));
  assert.ok(floating.includes('showSocialResponse'));
  assert.ok(!regularTalk.includes('AmbientVocabulary')); // The ordinary Talk renderer never invokes word substitution.

  const standalone = file('docs/tools/vocabulary-editor/index.html');
  const hub = file('docs/tools/index.html');
  const ambientTool = file('docs/tools/ambient-dialogue-editor/index.html');
  const editor = file('docs/js/ambient-vocabulary-editor.js');
  assert.ok(standalone.includes('ambient-vocabulary-rules.js') && standalone.includes('ambient-vocabulary-editor.js'));
  assert.ok(hub.includes('data-target="vocabulary-editor"') && hub.includes('id="fw-vocabulary-editor"'));
  assert.ok(!ambientTool.includes('ambient-vocabulary-editor.js'), 'The original Ambient Dialogue Editor must stay uncluttered');
  assert.ok(file('docs/index.html').includes('ambient-vocabulary.js'));
  assert.ok(editor.includes("['verbosity', 'Simplicity', 'Verbosity'"));
  assert.ok(editor.includes("['color', 'Technical', 'Colorful'"));
  assert.ok(editor.includes('data-check-synonym') && editor.includes('rules().generateSelections'));
  assert.ok(!editor.includes('data-vocab-table-alternatives'), 'NPC editor must not store duplicate synonym text lists');
  assert.ok(editor.includes('previewResult'));
  new Function('window', editor); // Parse actual integration script even without a browser DOM.
  console.log('Ambient vocabulary tests passed: shared checkbox references, global synonym updates, article agreement, tokens, floating dialogue isolation, standalone editor.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });