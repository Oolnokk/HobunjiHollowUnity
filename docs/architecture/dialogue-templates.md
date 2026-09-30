# Reusable dialogue and activity templates

`window.DialogueTemplates` expands data without adding NPC-specific branches or executing authored code. Templates can describe dialogue nodes, quest stages, shop demonstrations, recipes, or other serial activities.

Use the existing `{{playerName}}` tokens for player/NPC information. Use `{{context:item.label}}` for caller-supplied data. The dialogue editor's **Context key → Insert context placeholder** control inserts these tokens. In an ordinary dialogue tree, place the context on `tree.variables`; the dialogue renderer resolves it alongside existing tokens. Missing values remain visible, making unbound keys easy to spot.

For generated sequences:

```js
const nodes = DialogueTemplates.expand([
  { id: 'welcome', type: 'text', text: '{{playerName}}, welcome to {{context:shop}}.' },
  {
    $each: 'wares', as: 'ware',
    template: {
      id: 'ware_{{context:index}}', type: 'text',
      text: '{{context:ware.label}} costs {{context:ware.price}}.',
      price: { $value: 'ware.price' }
    }
  }
], { shop: 'Potter', wares: [{ label: 'Bowl', price: 4 }] });
```

String interpolation preserves existing player/phrase-pool tokens for the dialogue renderer. `$value` retains the referenced value's type. `$each` repeats a block, binds the current item under `as`, and supplies a zero-based `index`; results flatten into the surrounding sequence. Callers still own connections, validation, progression, and side effects. Paths traverse only own properties, prototype keys are blocked, collection length is limited to 200, and nesting to 20.

Mastery training is one consumer: `combat-tutorial-mastery.js` binds the equipped weapon and live technique/ammunition catalog to a single explanation/trial/closing pattern. Only the generated serial stages enter the existing tutorial controller; Spearhead's stored dialogue tree does not grow per weapon, rank, or upgrade.

`CombatProgression.beginPreview(toolKey, abilityId, level, index)` temporarily replaces that row's effects while retaining saved earlier rows and excluding later rows. It returns an ownership handle for `endPreview(handle)`. Previews never enter saved progression, and purchases for the previewed weapon are blocked while comparing it. The tutorial clears its handle on stage changes, exit, failure, and unexpected travel. Ranged comparisons use the existing private training ammunition state.
