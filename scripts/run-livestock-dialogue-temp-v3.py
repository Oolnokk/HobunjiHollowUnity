from pathlib import Path

source_path = Path('scripts/apply-livestock-dialogue-temp.py')
script = source_path.read_text()

old_visible = '''visible_stmt = "_npcDialogueEl.setAttribute('aria-hidden', 'false');"
if s.count(visible_stmt) != 1:
    raise SystemExit(f'dialogue visible statement count {s.count(visible_stmt)}')
s = s.replace(visible_stmt, visible_stmt + """
      // Animal-shaped speakers reuse the full NPC dialogue shell and camera, but
      // deliberately bypass NPC-only quests, favors, shops, and memory bookkeeping.
      if (options.skipNpcMeta === true) {
        window.DialogueContent?.beginNpcConversation(rec);
        return;
      }
""", 1)
'''
new_visible = '''visible_stmt = "_npcDialogueEl.setAttribute('aria-hidden', 'false');"
open_start = s.index('async function openNpcDialogue(walker, options = {}) {')
visible_at = s.index(visible_stmt, open_start)
visible_end = visible_at + len(visible_stmt)
s = s[:visible_end] + """
      // Animal-shaped speakers reuse the full NPC dialogue shell and camera, but
      // deliberately bypass NPC-only quests, favors, shops, and memory bookkeeping.
      if (options.skipNpcMeta === true) {
        window.DialogueContent?.beginNpcConversation(rec);
        return;
      }
""" + s[visible_end:]
'''

old_init = '''init_start = s.index('window.FarmAnimals?.init({')
init_end = s.index('});', init_start)
init_block = s[init_start:init_end]
if init_block.count('showToast,') != 1:
    raise SystemExit(f'FarmAnimals showToast dependency count {init_block.count("showToast,")}')
init_block = init_block.replace('showToast,', 'showToast,\\n      openLivestockDialogue,', 1)
s = s[:init_start] + init_block + s[init_end:]
'''
new_init = '''farm_init = 'window.FarmAnimals?.init({'
if s.count(farm_init) != 1:
    raise SystemExit(f'FarmAnimals init count {s.count(farm_init)}')
s = s.replace(farm_init, farm_init + '\\n      openLivestockDialogue,', 1)
'''

for old, new, label in [
    (old_visible, new_visible, 'dialogue visibility block'),
    (old_init, new_init, 'FarmAnimals dependency block'),
]:
    if old not in script:
        raise SystemExit(f'expected {label} not found')
    script = script.replace(old, new, 1)

# animal-chathead-frame.js itself did not change in this extension, so keep the
# existing cache tag that the framing regression intentionally pins.
script = script.replace(
    "'js/animal-chathead-frame.js?v=20260902livestock1'",
    "'js/animal-chathead-frame.js?v=20260901a'",
    1,
)

exec(compile(script, str(source_path), 'exec'), {})
