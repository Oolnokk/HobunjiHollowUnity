# Floating-speech vocabulary

The vocabulary transformer is intentionally separate from the ordinary NPC Talk dialogue. Only text passed to `AmbientDialogue.show(root, text, options)` is eligible, and only if a speaker ID and a matching source word/phrase exist. The authored line is never rewritten in storage; the optional one-shot change happens before the bubble's canvas texture, cadence schedule, duration, speech ticks and debug event are created. NPC acceptance/refusal, greeting, social reaction and festival speech reuse that path. Player progression and normal Talk are excluded.

## Single master synonym catalog

`docs/config/dialogue/ambient-vocabulary.json` owns the **only** copy of synonym text. Source words and phrases are keys under `lexicon`. Each alternative has `id`, `text`, `verbosity`, `color`, and `formality`; those three registers are independent 0–100 values. An optional `kind` distinguishes `standard`, `old-slang`, `simple`, and `near-miss`; historical slang also stores a `firstRecorded` year (strictly before 1900) and an evidence URL in `source`. A synonym's ID must remain stable when its displayed text is edited.

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

An existing `child` personality and a vocabulary-only `porakaneki` family provide separate starting presets. The named `porakaneki_chief` and dynamically generated `porakaneki_...` hunters resolve to the latter family without creating a duplicate reaction personality. Child-family NPCs (including generated `child_` IDs) prefer simplified and coined near-miss alternatives; adults with zero unusual-style sliders generate only standard entries. Manual checkboxes can still enable any globally approved entry for any character. The same single master entry can be checked by as many characters as needed. Legacy exported `character.table` word copies are converted to canonical IDs by the standalone editor on import, and can be read by the runtime for compatibility. Nonexistent IDs are ignored rather than converted to freeform text.

## Authoring in the standalone workshop

Open **Dev Tools → Vocabulary Workshop**. It is not embedded in the already crowded Ambient Dialogue Editor.

* **Master dictionary**: search any source word or phrase; author shared synonyms, three style coordinates and their stable IDs once; rename any synonym without invalidating the checks. A deleted synonym removes its existing checkmarks.
* **Personality family**: use the six independent defaults for the six existing shared reaction profiles.
* **Character**: inspect/check/uncheck every canonical alternative under a source phrase. The character's checkbox overrides apply per source word. Clear them to inherit generated defaults. Regenerating *all* checkmarks explicitly overwrites manual choices; the batch generator only initializes NPCs that have no manual choices.
* **Live preview**: experiment with an authored sentence using exactly the same runtime matcher and selected IDs. Import/export acts on **only** this vocabulary JSON, not dialogue, reactions or character data.

The nine sliders are **simplicity–verbosity**, **technical–colorful**, **casual–formal**, vocabulary breadth, variation, substitution frequency, **pre-1900 historical slang**, **over-simple wording**, and **almost-right wording**. A stable per-speaker ±12 point offset gives otherwise similar family members distinct starting ranges. Breadth varies both source word coverage and candidate count. Variation determines how many of those candidates are checked by default. Frequency determines the random chance to use any checked alternative when a line is displayed.

## Grammar, fallback and performance

Tokens such as `{targetName}` and `{{playerName}}` are protected. Matches respect Unicode whole-word/phrase boundaries and prefer longer source phrases. Capitalization is preserved. When a preceding `a` or `an` would obviously be invalid after substitution, the word is left as authored. This is a conservative spelling check, **not** full grammatical inflection, so authors should keep alternatives compatible with the source word's part of speech and sentence context. No online language model or thesaurus runs during gameplay.

An absent config, unmatched sentence, failed optional module, unrecognized synonym ID, or an excluded dialogue path always leaves the original line unchanged. A global source-word matcher skips per-speaker vocabulary work for most speech. The engine builds per-speaker tables **lazily on a matching bubble only**, caches them with a 128-speaker LRU, and never performs vocabulary work during the frame update.

`AmbientDialogue.getDebug().vocabulary` and `AmbientVocabulary.getDebug()` report readiness, last authored/displayed line, matching and swapping counts, vocabulary size and cached speaker count on mobile. Run `node scripts/test-ambient-vocabulary.js` to test shared references, controls, fallbacks, token protection, article agreement, and speech scope. Its real browser visuals should also be smoke-tested on mobile before merging.

## Historical slang and intentionally imperfect speech

The starter lexicon contains **79 source words or phrases and 292 centrally authored alternatives**, including 21 tagged instances of pre-1900 slang. Examples include *balderdash* (nonsense by the 1670s), *humbug* (1751), *grub* (food from the 1650s), *chum* (1680s), *skedaddle* (1861), and *spondulicks* (1856); each tagged entry carries an etymology reference. The historical cutoff applies to **recorded English usage of the same sense**, not merely to words that look old. Modern slang (1900 onward) is deliberately excluded from automatic historical selection.

`simple` alternatives are intentionally plain or repetitious (*food* → *stuff to eat*); `near-miss` alternatives are invented, deliberately approximate childlike vocabulary (*mysterious* → *mystery-ish*, *blizzard* → *snow-fury*). The categories are independent: a Porakaneki can favor centuries-old slang without childish mistakes, and a child can prefer mistakes without slang. Setting a style slider to zero excludes that style from automatic generation. Manual checkmarks override the stylistic sliders, including deliberate exclusions; undated/post-1899 historical slang remains blocked until its evidence is corrected.

The three style coordinates and three unusual-speech sliders are independent. Categorized alternatives first pass a stable per-speaker inclusion gate, then compete in the existing authored-style ranking. This keeps NPCs from acquiring identical speech automatically. Master Dictionary permits editing each entry's **style kind** and documented **first attested year** without changing its stable ID or removing any NPC checkbox.

Spelling-oriented grammar checks cannot reliably catch all shifts in meaning, article pronunciation, inflection or sentence framing. In particular, coined malapropisms are intentionally odd; authors should preview complete sample sentences before checking them for characters. The original ambient speech remains the fallback whenever an eligible replacement is unavailable.
