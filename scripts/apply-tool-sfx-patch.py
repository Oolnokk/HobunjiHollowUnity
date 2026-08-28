from pathlib import Path
import re

game_path = Path('docs/game.js')
config_path = Path('docs/config/scratchbones-config.js')
test_path = Path('scripts/test-tool-action-sfx-wiring.js')
game = game_path.read_text()
config = config_path.read_text()


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, got {count}')
    return text.replace(old, new, 1)


# The live config uses the newer fallback-aware objectSfx shape:
# { url, placeholderUrl(s), volume, ... }. Scope the match to objectSfx so
# unrelated "dig" keys elsewhere in the game config cannot be touched.
object_marker = '"objectSfx": {'
object_start = config.find(object_marker)
if object_start < 0:
    raise SystemExit('object SFX config: objectSfx section not found')
object_tail = config[object_start:]
dig_match = re.search(r'(?ms)^          "dig": \{.*?^          \},', object_tail)
if not dig_match:
    raise SystemExit('object SFX config: dig entry not found in objectSfx')
dig_block = dig_match.group(0)
if 'assets/audio/sfx/farming/sfx_dig.mp3' not in dig_block:
    raise SystemExit('object SFX config: current dig URL was not the expected legacy path')
for key in ('pick', 'chop', 'breakTree', 'breakRock'):
    if re.search(rf'(?m)^          "{re.escape(key)}": \{{', object_tail):
        raise SystemExit(f'object SFX config: {key} already exists; refusing to duplicate it')

new_dig_block = dig_block.replace(
    'assets/audio/sfx/farming/sfx_dig.mp3',
    'assets/audio/sfx/sfx_dig.mp3',
    1,
)
new_entries = '''
          "pick": {
            "url": "assets/audio/sfx/sfx_pick.mp3",
            "volume": 0.8
          },
          "chop": {
            "url": "assets/audio/sfx/sfx_chop.mp3",
            "volume": 0.8
          },
          "breakTree": {
            "url": "assets/audio/sfx/sfx_break_tree.mp3",
            "volume": 0.8
          },
          "breakRock": {
            "url": "assets/audio/sfx/sfx_break_rock.mp3",
            "volume": 0.8
          },'''
new_dig_block = new_dig_block + new_entries
absolute_start = object_start + dig_match.start()
absolute_end = object_start + dig_match.end()
config = config[:absolute_start] + new_dig_block + config[absolute_end:]

# Shared helper keeps tool cues on AudioSystem's configured volume/fallback path.
state_anchor = '''      let pendingAction = null;
      let strikeFired   = false;
'''
state_replacement = '''      let pendingAction = null;
      let strikeFired   = false;

      function playConfiguredToolSfx(key) {
        const entry = window.AudioSystem?.objectSfxConfig?.()?.[key]; // Used by strike-stage and terminal tool-result cues below.
        if (entry) window.AudioSystem?.playObjectSfx(entry);
      }
'''
game = replace_once(game, state_anchor, state_replacement, 'tool SFX helper anchor')

# Only animation stages that actually make contact get an impact cue.
# The paired toss/twist/reset stages intentionally remain silent.
thrust_stage = "        { anim: 'thrust', dur },"
if game.count(thrust_stage) != 2:
    raise SystemExit(f'dig/dew thrust stages: expected 2 matches, got {game.count(thrust_stage)}')
game = game.replace(thrust_stage, "        { anim: 'thrust', dur, sfxKey: 'dig' },")
game = replace_once(
    game,
    "        { anim: 'refillTurnOut',    dur: 1.0  },",
    "        { anim: 'refillTurnOut',    dur: 1.0,  sfxKey: 'dig' },",
    'refill first strike',
)
game = replace_once(
    game,
    "        { anim: 'refillStrikeBack', dur: 0.5  },",
    "        { anim: 'refillStrikeBack', dur: 0.5,  sfxKey: 'dig' },",
    'refill second strike',
)
game = replace_once(
    game,
    "      const CHOP_TREE_STAGES = [1, -1, 1].map(dirSign => ({ pose: true, dirSign, dur: 0.55 }));",
    "      const CHOP_TREE_STAGES = [1, -1, 1].map(dirSign => ({ pose: true, dirSign, dur: 0.55, sfxKey: 'chop' }));",
    'chop stages',
)
game = replace_once(
    game,
    "      const MINE_ROCK_STAGES = [0, 0, 0].map(() => ({ anim: 'thrust', dur: 0.55 }));",
    "      const MINE_ROCK_STAGES = [0, 0, 0].map(() => ({ anim: 'thrust', dur: 0.55, sfxKey: 'pick' }));",
    'mine stages',
)

# Held charge sequences deliberately keep pendingAction=null. Give them a
# one-shot at the same visual strike fraction used by ordinary tool actions.
strike_gate = '''        if (pendingAction && !strikeFired && progress >= SF) {
          strikeFired = true;
          firePendingAction();
        }
'''
strike_replacement = '''        if (chargeAction && !strikeFired && progress >= SF) {
          strikeFired = true;
          const chargeSfxKey = chargeAction.stages?.[chargeAction.stage]?.sfxKey; // Used to sound only authored contact stages, not toss/twist/reset stages.
          if (chargeSfxKey) playConfiguredToolSfx(chargeSfxKey);
        }
        if (pendingAction && !strikeFired && progress >= SF) {
          strikeFired = true;
          const pendingSfxKey = pendingAction.tool === 'shovel' && ['dig', 'fill', 'raise'].includes(pendingAction.action) ? 'dig' : null; // Used for single-strike shovel actions outside the held sequence state machine.
          if (pendingSfxKey) playConfiguredToolSfx(pendingSfxKey);
          firePendingAction();
        }
'''
game = replace_once(game, strike_gate, strike_replacement, 'strike timing gate')

# Terminal cues live in the authoritative successful state transitions, not
# in visual cleanup, scene rebuild, persistence loading, or regrowth paths.
axe_pattern = re.compile(r"(if \(tool === 'axe' && action === 'chop' && isChoppableTreeTile\(col, row\)\) \{[\s\S]*?awardToolUseMasteryXp\('axe'\);)")
game, axe_count = axe_pattern.subn(r"\1\n          playConfiguredToolSfx('breakTree');", game, count=1)
if axe_count != 1:
    raise SystemExit(f'breakTree terminal branch: expected 1 match, got {axe_count}')
pick_pattern = re.compile(r"(if \(tool === 'pick' && action === 'mine' && isMineableRockTile\(col, row\)\) \{[\s\S]*?awardToolUseMasteryXp\('pick'\);)")
game, pick_count = pick_pattern.subn(r"\1\n          playConfiguredToolSfx('breakRock');", game, count=1)
if pick_count != 1:
    raise SystemExit(f'breakRock terminal branch: expected 1 match, got {pick_count}')

# Mobile-friendly regression check: this runs in CI and leaves a compact,
# readable failure instead of requiring a browser console inspection.
test_path.write_text(r'''const fs = require('fs');
const assert = require('assert');
const game = fs.readFileSync('docs/game.js', 'utf8');
const config = fs.readFileSync('docs/config/scratchbones-config.js', 'utf8');
for (const file of ['sfx_dig.mp3', 'sfx_pick.mp3', 'sfx_chop.mp3', 'sfx_break_tree.mp3', 'sfx_break_rock.mp3']) {
  assert(config.includes(`assets/audio/sfx/${file}`), `missing configured ${file}`);
}
assert(!config.includes('assets/audio/sfx/farming/sfx_dig.mp3'), 'dig must not use the legacy farming path');
assert(game.includes("sfxKey: 'dig'"), 'shovel contact stages need dig SFX');
assert(game.includes("sfxKey: 'chop'"), 'axe chop stages need chop SFX');
assert(game.includes("sfxKey: 'pick'"), 'pick mine stages need pick SFX');
assert(game.includes("chargeAction && !strikeFired && progress >= SF"), 'held stages must fire at the shared strike fraction');
assert(game.includes("pendingAction.tool === 'shovel'"), 'single-strike shovel actions need dig SFX');
assert(game.includes("playConfiguredToolSfx('breakTree')"), 'tree terminal success needs break SFX');
assert(game.includes("playConfiguredToolSfx('breakRock')"), 'rock terminal success needs break SFX');
assert(!/refillTwist(?:Out|Back)'[^\n]*sfxKey/.test(game), 'shovel twist stages must stay silent');
assert(!/refillReset'[^\n]*sfxKey/.test(game), 'shovel reset stage must stay silent');
assert(!/anim: 'toss'[^\n]*sfxKey/.test(game), 'dirt toss stages must stay silent');
console.log('tool action SFX wiring: ok');
''')

game_path.write_text(game)
config_path.write_text(config)
