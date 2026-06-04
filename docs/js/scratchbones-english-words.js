// Scratchbones English word list for Engh-sho first names.
//
// Names can be multi-word: any modifiers + a final noun.
// TINY_TRIGGERS ('tiny', 'miniature') unlock SIZEABLE_NOUNS and LIVING_NOUNS
// as valid final words — the name is assumed to refer to a statuette.
// If the user types a large or living thing without a trigger, "Tiny X" and
// "Miniature X" are suggested automatically.
//
// All entries 3-8 characters, lowercase, sorted, no duplicates.
(function(global){
  'use strict';

  global.SCRATCHBONES_TINY_TRIGGERS = ['tiny', 'miniature'];

  // Final-word pool: physical objects naturally graspable in one hand
  global.SCRATCHBONES_ENGLISH_WORDS = [
    // tools and implements
    "awl","bit","hoe","key","saw","adze","bore","pick","rasp","shim",
    "tang","vise","whet","anvil","auger","bevel","brace","brush","burin",
    "clamp","drill","gauge","gouge","graver","lathe","level","mallet",
    "maul","plane","plumb","probe","punch","razor","scoop","screw",
    "shovel","sickle","sieve","socket","spatula","spike","stamp","stave",
    "stylus","tongs","trowel","wrench","bodkin","chisel","gimlet","grater",
    "inkpot","lancet","pliers","ratchet","syringe",
    // weapons
    "axe","bow","mace","barb","bolt","dart","dirk","flail","hilt",
    "lance","saber","shaft","shiv","sword","arrow","dagger","rapier",
    "quiver","sling","cutlass","stiletto",
    // small containers
    "cup","jar","jug","keg","pan","pot","tin","tub","urn","vat",
    "bowl","case","crock","dish","ewer","pail","phial","vase","vial",
    "canteen","flagon","flask","goblet","ladle","mortar","pitcher",
    "pouch","purse","satchel","vessel","wallet","capsule",
    // hardware and fasteners
    "bar","cog","lid","peg","pin","rod","clip","hook","knob","lace",
    "link","lock","loop","mesh","nail","plug","ring","snap","stud",
    "tack","tube","wick","wire","brad","fuse","prong","rivet","buckle",
    "clasp","cleat","collar","cotter","cramp","dowel","eyelet","ferrule",
    "grommet","hasp","hinge","latch","shackle","spring","staple","toggle",
    "washer",
    // fiber and textile
    "coil","knot","rope","sash","bead","skein","spool","strand","string",
    "thread","twine","bobbin","sinew","thong",
    // natural handheld objects
    "nut","orb","pod","bud","pip","acorn","amber","bark","bone","burr",
    "chip","clay","clod","coal","cone","coral","flax","flint","frond",
    "grain","husk","jade","leaf","lump","opal","ore","peel","pebble",
    "rind","rock","root","reed","seed","shard","shell","sliver","spore",
    "stem","stone","thorn","twig","wood","feather","kernel","nugget",
    "walnut","cobble","chestnut",
    // gems and minerals
    "gem","opal","ruby","agate","beryl","flint","garnet","pearl","quartz",
    "topaz","crystal","diamond","emerald","granite","jasper","obsidian",
    "sapphire","spinel","lignite","pyrite",
    // coins, tokens, seals
    "die","disc","coin","slug","flan","obol","rune","seal","tab","badge",
    "medal","pawn","token","tally","sigil","wafer","pellet","counter",
    "medallion",
    // jewelry and adornments
    "torc","cameo","charm","locket","amulet","anklet","bangle","brooch",
    "earring","pendant","signet","trinket","talisman","circlet",
    // small instruments
    "bell","drum","fife","horn","lute","pipe","reed","flute","rattle",
    "whistle","kazoo","ocarina",
    // lights and fire tools
    "lamp","wick","candle","lantern","tinder","striker",
    // domestic small objects
    "comb","cube","fork","gavel","mold","mug","spoon","thimble","tile",
    "wand","bottle","button","sponge","dipper",
    // materials as handled pieces
    "blob","disk","drop","flake","foil","grit","hull","ingot","plank",
    "plaque","slab","tablet","wedge","whorl",
    // craft objects
    "blank","block","mandrel","pestle","shuttle","spindle",
    // small optics
    "lens","prism","monocle","compass",
    // writing
    "quill","scroll",
    // small military kit
    "buckler","gorget","rondel",
    // games and toys
    "ball","marble","puppet","top",
    // hunting and fishing
    "lure","snare","sinker","bobber","decoy",
    // weights
    "weight"
  ]
  .filter((w,i,a) => w.length>=3 && w.length<=8 && a.indexOf(w)===i)
  .sort();

  // Extra physical objects — normally too large to hold, valid as final word
  // only when a TINY_TRIGGER precedes (e.g. "Tiny Barrel", "Miniature Forge")
  global.SCRATCHBONES_SIZEABLE_NOUNS = [
    "arch","barrel","basket","bellows","bench","boat","bridge","cannon",
    "cart","cask","cauldron","chair","chest","churn","cistern","crane",
    "door","forge","furnace","gate","harp","kettle","loom","mirror",
    "oven","plow","press","saddle","shield","sled","stool","table",
    "throne","tower","trough","wagon","wall","wheel","winch"
  ]
  .filter((w,i,a) => w.length>=3 && w.length<=8 && a.indexOf(w)===i)
  .sort();

  // Living things — valid as final word only when a TINY_TRIGGER precedes,
  // implying a statuette (e.g. "Tiny Dragon", "Miniature Knight")
  global.SCRATCHBONES_LIVING_NOUNS = [
    // animals
    "ape","asp","bat","bee","cat","cod","cow","doe","dog","elk","emu",
    "ewe","fly","fox","gnu","hen","hog","jay","koi","owl","pig","pup",
    "ram","rat","bear","bird","boar","buck","bull","carp","clam","colt",
    "crab","crow","deer","dove","duck","fawn","fish","flea","frog","gnat",
    "goat","hare","hawk","ibis","kite","lamb","lion","lynx","mare","mink",
    "mole","moth","mule","newt","pony","puma","slug","swan","toad","wasp",
    "wolf","worm","crane","eagle","finch","gecko","heron","hippo","horse",
    "hyena","koala","lemur","llama","moose","mouse","otter","panda","quail",
    "raven","robin","shark","sheep","shrew","skunk","sloth","snake","squid",
    "stork","swift","tapir","tiger","trout","viper","vole","whale","zebra",
    "badger","beetle","condor","donkey","falcon","ferret","gopher","iguana",
    "jaguar","lizard","magpie","monkey","osprey","parrot","pigeon","rabbit",
    "salmon","spider","toucan","turkey","turtle","walrus","weasel","buffalo",
    "caribou","cheetah","dolphin","gorilla","hamster","lobster","panther",
    "peacock","penguin","pelican","sparrow","stallion",
    // mythical creatures
    "fay","imp","drake","fairy","gnome","golem","harpy","nixie","nymph",
    "satyr","troll","wyrm","pixie","sprite","sylph","wyvern","banshee",
    "centaur","cyclops","dragon","goblin","griffin","kraken","mermaid",
    "minotaur","phoenix","siren","sphinx","unicorn","vampire",
    // people types (as figurines)
    "bard","dame","duke","earl","mage","monk","page","sage","serf","witch",
    "dwarf","giant","guard","witch","archer","druid","giant","herald",
    "jester","knight","priest","ranger","rogue","squire","wizard","paladin",
    "pilgrim","soldier","warlock","shaman",
    // plants (as decorative statuettes)
    "ash","elm","fir","ivy","oak","yew","cane","fern","lily","pine",
    "rose","vine","bush","herb","palm","birch","cedar","daisy","lotus",
    "maple","poppy","tulip","violet"
  ]
  .filter((w,i,a) => w.length>=3 && w.length<=8 && a.indexOf(w)===i)
  .sort();

})(typeof window !== 'undefined' ? window : this);
