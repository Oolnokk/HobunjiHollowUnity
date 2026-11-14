# Wildlife herd turnover

## Surface-herd turnover

The Northern Cliffs have two independent roaming-herd slots, each with a daily species roll from **Moot** and **Voorg-Ass**. Either species can occupy both slots, or the population can be mixed. Both appear in herds of 8–12 adults, with one genotype per herd; only Voorg-Asses have a Herd-Mother carrying babies. Nazgraku gatherers retain their own small reserved forager slot.

The shared `WildlifeSpawn.advanceCaveMidnight` civil-midnight hook re-rolls surface herds in all zones that declare `roamingHerdSpecies`. Herds entirely beyond **24 tiles** from the player disappear at midnight and may be repopulated off-camera. If even one living member is close, the whole herd remains in place until the player exits its map; only then is the pending turnover applied. A slot's species does not change within the same day, and corpse loot is preserved. This uses the existing two-second wildlife spawn scan, with no extra timer or frame loop.

The mobile 🧬 Wildlife tab shows each slot's actual species, alive adults, Herd-Mothers, and pending map-exit turnover. In the Southern Cloud Forest, a separate Honeyfuzzle hive census shows generated/standing stumps and active swarms, to distinguish absent habitat from hidden nighttime wildlife.

