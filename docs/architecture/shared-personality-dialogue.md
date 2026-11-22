# Shared NPC dialogue ownership

Ordinary conversation copy is scoped in `docs/config/dialogue/shared-dialogue.json`, rather than placed in an unrestricted world-wide greeting pool. It supplements (but does not replace) character-authored `dialogueTrees` and `phrasePools`.

## Ownership

- `personalityFamilies.<profileId>` is a reusable line pool for NPCs explicitly assigned a matching personality in `docs/config/dialogue/npc-reaction-profiles.json`. The supported starter families are `neighborly`, `playful`, `reserved`, `proper`, `stern`, and `child`. **Edit the assignment only in that existing reaction-personality config.**
- `characters.<npcId>` holds extra casual lines spoken only by that specific character. Character entries are offered before their family entries, but both can eventually cycle.
- NPCs with no valid explicit profile assignment receive no generic personality dialogue. Generated `child_...` IDs may inherit Child if they enter the standard database composition path. Stateful child dialogue providers keep their own higher-priority lines.

Individual dialogue history is still stored per NPC, using namespaced stable generated tree IDs. A shared family line heard from Pahu does **not** count as heard for another Playful character.

## Priority

1. Queued/scripted trees, feature providers, authored non-fallback trees and Shop/Chat access retain their existing rules.
2. Existing individual fallback text and condition-eligible, **not-yet-heard**, genuinely authored entries in its phrase pool are allowed to speak first. Writer-facing `<placeholder>` hints are not playable dialogue until replaced with actual text.
3. After that personal content, eligible unheard character-scoped shared speech goes before eligible unheard family-scoped speech.
4. Once both the personal and scoped lines have circulated, each new ordinary Talk conversation has a chance to use the individual's original fallback again, or a random eligible scoped line. An unmet weather/relationship/location condition never promotes ineligible lines.

Every shared entry supports `id` (stable per owning character or family), `label`, `text`, `priority`, `conditions`, `excludeConditions` and `visibility`, using the same condition schema as ordinary dialogue trees. Shared text supports the existing normal dialogue tokens, e.g. `{{playerName}}`. This is ordinary one-line Talk dialogue; quest branches and scripted effects belong in the character's dialogue tree as before.

```json
{
  "personalityFamilies": {
    "reserved": [
      {
        "id": "quiet_rain",
        "label": "Watching the rain",
        "text": "I like it when the rain makes everything a little quieter.",
        "conditions": { "weather": ["rain"] }
      }
    ]
  },
  "characters": {
    "pahu": [
      { "id": "pahu_sailing", "text": "Now that's a fine wind! Makes me want to find a sail." }
    ]
  }
}
```

## Composition and debugging

`LocalDBOverrides.loadDatabase('npcDatabase')` and the direct NPC database fetch path both compose the same shared layer in `docs/js/local-db-overrides.js`. Canonical NPC JSON and local editor overrides are not rewritten. The process is idempotent, and optional config failure leaves the preexisting NPC dialogue intact.

The Dev Companion **Conversation state** panel displays the resolved `Shared voice family` and `Scoped shared lines`, and dialogue traces mark whether a selected tree came from the personality/character shared config. This is usable without a desktop browser console.

Run `node scripts/test-shared-personality-dialogue.js` to exercise the actual composer, condition selector and conversation renderer. The original NPC database also has unique greetings for most starter characters; do not migrate or delete those when adding shared lines.
