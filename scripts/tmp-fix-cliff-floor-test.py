from pathlib import Path
p = Path('scripts/test-banubu-wilderness-lab-generation.js')
s = p.read_text()
s = s.replace("'the north-adjacent low side of Banubu's chosen cliff must exactly equal the derived locale floor tier'", '"the north-adjacent low side of Banubu\'s chosen cliff must exactly equal the derived locale floor tier"')
p.write_text(s)
