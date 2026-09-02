from pathlib import Path

path = Path('docs/game.js')
text = path.read_text()

old = """          const bInteractable = _buildingInteractables.get(currentArea + ',' + bReticle.col + ',' + bReticle.row);\n          if (bInteractable) return bInteractable.getButtons();\n          // Building interiors return early above and never reach the\n"""
new = """          const bInteractable = _buildingInteractables.get(currentArea + ',' + bReticle.col + ',' + bReticle.row);\n          if (bInteractable) return bInteractable.getButtons();\n          // Procedural mine floors are building interiors, so they return from\n          // this branch before the general wilderness/town action block below.\n          // Surface campfires are handled there; mine campfires must expose the\n          // same nearby Save/Cook/Brew actions here instead.\n          const mineCampfireActions = window.TownMine?.floorFromMapId?.(currentArea)\n            ? window.WildernessCampfire?.getNearbyActions?.()\n            : null;\n          if (mineCampfireActions?.length) return mineCampfireActions;\n          // Building interiors return early above and never reach the\n"""
if old not in text:
    raise SystemExit('building-interactable anchor not found')
text = text.replace(old, new, 1)

old = """          if (heldMode === 'item') {\n            const heldItem = getActiveInventoryItem();\n            const flaskActions = window.AlchemyFlasks?.heldActions?.() || [];\n"""
new = """          if (heldMode === 'item') {\n            const heldItem = getActiveInventoryItem();\n            // Mine floors are building interiors, so the general held-item\n            // campfire-kit branch below is unreachable here. Mirror it in this\n            // early-return branch so Action 1 can actually set up a campfire\n            // underground instead of silently omitting the button.\n            if (heldItem && heldItem.key === 'campfireKitFurniture' && window.WildernessCampfire?.supportsArea?.(currentArea)) {\n              return [{ icon: '🔥', label: 'Set Up Campfire', action: 'place_campfire_kit', style: 'primary', allowed: (inventory[heldItem.key] || 0) > 0 }];\n            }\n            const flaskActions = window.AlchemyFlasks?.heldActions?.() || [];\n"""
if old not in text:
    raise SystemExit('building held-item anchor not found')
text = text.replace(old, new, 1)

path.write_text(text)
