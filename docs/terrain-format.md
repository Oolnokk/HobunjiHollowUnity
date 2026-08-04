# Terrain elevation fields

Exterior `hobunji_map.v1` records have three independent elevation concepts:

* **`tiles["col,row"].elevTier`** is a discrete gameplay terrain tier. It is
  produced while plateau submaps are merged and can create cliffs, collision,
  and impassable incline cells.
* **`tiles["col,row"].rampElevation`** is the authored traversal surface for a
  ramp between discrete tiers. It participates in rendered and gameplay surface
  height and remains navigation-relevant because the tile is a ramp.
* **`visualHeights["col,row"]`** is a sparse, normalized, visual-only scalar.
  Missing entries mean zero. The runtime bilinearly interpolates values authored
  at tile centers, clamps them to the shared terrain configuration, and converts
  them to a displacement smaller than one plateau unit. It never changes tile
  type, `elevTier`, `rampElevation`, collision, passability, route nodes,
  transitions, targeting coordinates, or saved positions.

Submap values use submap-local coordinates and are translated to root-world
coordinates by the same recursive merge offsets as tiles and anchored content.
At missing cells and beyond root-map boundaries the sampled value is zero.

## Slope conformance policy

Rigid, multi-tile buildings remain level and use one sample at their authored
anchor. Terrain-hugging actors, shadows, indicators, furniture, and decor sample
their own rendered world X/Z. The base tile, plateau, or ramp surface is resolved
first and subtle displacement is added exactly once.
