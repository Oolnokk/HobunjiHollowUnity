# Floating-speech vocabulary

The vocabulary transformer is intentionally separate from the ordinary NPC Talk dialogue. Only text passed to `AmbientDialogue.show(root, text, options)` is eligible, and only if a speaker ID and a matching source word/phrase exist. The authored line is never rewritten in storage; the optional one-shot change happens before the bubble's canvas texture, cadence schedule, duration, speech ticks and debug event are created. NPC acceptance/refusal, greeting, social reaction and festival speech reuse that path. Player progression and normal Talk are excluded.

## Single master synonym catalog

`docs/config/dialogue/ambient-vocabulary.json` owns the **only** copy of synonym text. Source words and phrases are keys under `lexicon`. Each alternative is a record containing `id`, `text`, `verbosity`, `color`, and `formality`; those three registers are independent 0–100 values. A synonym's ID must remain stable when its displayed text is edited.

Each character's `characters.<npcId>.selections` stores **only checkbox references**, never a second list of synonym text. The shape is `{ "<source word>": ["<synonym id>", "..."] }`. A missing source word inherits that character's slider-generated choices. An explicitly present empty array means no substitutions for that word. The catalog is resolved to a short-lived render table when a speaker needs it, and is cached in memory for at most 128 distinct speakers. If a master synonym is renamed, every NPC who checked its ID automatically speaks the new text.

```json
{
  "lexicon": {
    "lovely": [
      { "id": "nice", "text": "nice", "verbosity": 20, "color": 35, "formality": 20 },
      { "id": "splendid", "text": "splendid", "verbosity": 65, "color": 65, "formality": 85 }
    ]
  },
  "characters": {
    "pahu": {
      "sliders": { "frequency": 70 },
      "selections": { "lovely": ["nice"] }
    }
  }
}
```

The same single master entry can be checked by as many characters as needed. Legacy exported `character.table` word copies are converted to canonical IDs by the standalone editor on import, and can be read by the runtime for compatibility. Nonexistent IDs are ignored rather than converted to freeform text.

## Authoring in the standalone workshop

Open **Dev Tools → Vocabulary Workshop**. It is not embedded in the already crowded Ambient Dialogue Editor.

* **Master dictionary**: search any source word or phrase; author shared synonyms, three style coordinates and their stable IDs once; rename any synonym without invalidating the checks. A deleted synonym removes its existing checkmarks.
* **Personality family**: use the six independent defaults for the six existing shared reaction profiles.
* **Character**: inspect/check/uncheck every canonical alternative under a source phrase. The character's checkbox overrides apply per source word. Clear them to inherit generated defaults. Regenerating *all* checkmarks explicitly overwrites manual choices; the batch generator only initializes NPCs that have no manual choices.
* **Live preview**: experiment with an authored sentence using exactly the same runtime matcher and selected IDs. Import/export acts on **only** this vocabulary JSON, not dialogue, reactions or character data.

The sliders are **simplicity–verbosity**, **technical–colorful**, **casual–formal**, vocabulary breadth, variation, and substitution frequency. A stable per-speaker ±12 point offset gives otherwise similar family members distinct starting ranges. Breadth varies both source word coverage and candidate count. Variation determines how many of those candidates are checked by default. Frequency determines the random chance to use any checked alternative when a line is displayed.

## Grammar, fallback and performance

Tokens such as `{targetName}` and `{{playerName}}` are protected. Matches respect Unicode whole-word/phrase boundaries and prefer longer source phrases. Capitalization is preserved. When a preceding `a` or `an` would obviously be invalid after substitution, the word is left as authored. This is a conservative spelling check, **not** full grammatical inflection, so authors should keep alternatives compatible with the source word's part of speech and sentence context. No online language model or thesaurus runs during gameplay.

An absent config, unmatched sentence, failed optional module, unrecognized synonym ID, or an excluded dialogue path always leaves the original line unchanged. A global source-word matcher skips per-speaker vocabulary work for most speech. The engine builds per-speaker tables **lazily on a matching bubble only**, caches them with a 128-speaker LRU, and never performs vocabulary work during the frame update.

`AmbientDialogue.getDebug().vocabulary` and `AmbientVocabulary.getDebug()` report readiness, last authored/displayed line, matching and swapping counts, vocabulary size and cached speaker count on mobile. Run `node scripts/test-ambient-vocabulary.js` to test shared references, controls, fallbacks, token protection, article agreement, and speech scope. Its real browser visuals should also be smoke-tested on mobile before merging.
