from pathlib import Path

source_path = Path('scripts/apply-livestock-dialogue-temp.py')
script = source_path.read_text()
old = '''visible_stmt = "_npcDialogueEl.setAttribute('aria-hidden', 'false');"
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
new = '''visible_stmt = "_npcDialogueEl.setAttribute('aria-hidden', 'false');"
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
if old not in script:
    raise SystemExit('expected dialogue visibility patch block not found')
script = script.replace(old, new, 1)
exec(compile(script, str(source_path), 'exec'), {})
