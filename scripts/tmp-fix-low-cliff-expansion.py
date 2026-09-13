from pathlib import Path

p = Path('docs/js/locale-terrain-placement.js')
s = p.read_text()
old = """      if (isCliff && rule.facing !== 'any' && scale > 1) {
        for (let i = 0; i < scale; i++) {
          const dx = rule.facing === 'west' ? 0 : rule.facing === 'east' ? scale - 1 : i;
          const dy = rule.facing === 'north' ? 0 : rule.facing === 'south' ? scale - 1 : i;
          const c = parsed.c * scale + dx;
          const r = parsed.r * scale + dy;
          output.set(sourceKey(c, r), { c, r, sourceC: parsed.c, sourceR: parsed.r, value: rule });
        }
        continue;
      }
"""
new = """      if (isCliff && rule.facing !== 'any' && scale > 1) {
        const lowSideRelative = rule.height?.mode === 'relativeRange' && rule.height?.max != null && rule.height.max <= 0; // A Δ0-or-lower cliff probe denotes the low side, so density expansion must sample the edge touching the higher neighbor rather than the outward high-side edge.
        for (let i = 0; i < scale; i++) {
          const dx = rule.facing === 'west' ? (lowSideRelative ? scale - 1 : 0) : rule.facing === 'east' ? (lowSideRelative ? 0 : scale - 1) : i;
          const dy = rule.facing === 'north' ? (lowSideRelative ? scale - 1 : 0) : rule.facing === 'south' ? (lowSideRelative ? 0 : scale - 1) : i;
          const c = parsed.c * scale + dx;
          const r = parsed.r * scale + dy;
          output.set(sourceKey(c, r), { c, r, sourceC: parsed.c, sourceR: parsed.r, value: rule });
        }
        continue;
      }
"""
if old in s:
    s = s.replace(old, new, 1)
elif 'const lowSideRelative =' not in s:
    raise SystemExit('scaled cliff probe block not found')
p.write_text(s)
