import "server-only";
import type { ConnectionsPuzzle } from "./connections";

/**
 * The Connections puzzle set.
 *
 * `server-only`, for the same reason wordle-answers.ts is: the groups ARE the
 * solution, and a browser holding this file has solved every board this app
 * will ever serve.
 *
 * ## What makes one of these a puzzle
 *
 * Sixteen words in four honest categories is a sorting exercise, not a game.
 * The game is the *overlap*: every set below plants words that plainly belong
 * to a category they are not in, so the easy read is wrong and the player has
 * to find the assignment that makes all four groups work at once. P1 puts
 * JAGUAR with the cars and TIGER with the cats while a tiger shark waits in a
 * third group; P5 hides FOLD among poker actions with WASH/DRY/PRESS sitting
 * right there. A set without at least one of those is a set worth rewriting.
 *
 * Levels run 0 (yellow, the category you see immediately) to 3 (purple,
 * usually wordplay or a shared hidden second meaning). That ramp is what makes
 * the shared emoji grid readable as a story rather than a scorecard, so it is
 * worth honouring when adding a set -- a puzzle whose purple is easier than
 * its yellow produces share text that reads as luck.
 *
 * ## House style
 *
 * Tiles are single words where possible and never longer than about ten
 * characters: the board is four across on a phone, and a long tile either
 * shrinks the type until it is unreadable or wraps and breaks the grid.
 * Labels are short for the same reason -- they sit on one solved row.
 *
 * Adding a set is this array and nothing else. dailyIndex (daily.ts) walks the
 * pool, so the cycle length is exactly the number of entries here, and a new
 * one changes the schedule from the day it lands rather than reshuffling
 * anything already played.
 */
export const CONNECTIONS_PUZZLES: readonly ConnectionsPuzzle[] = [
  {
    groups: [
      { level: 0, label: "Big cats", members: ["LION", "TIGER", "LEOPARD", "PANTHER"] },
      { level: 1, label: "Card games", members: ["BRIDGE", "HEARTS", "POKER", "RUMMY"] },
      { level: 2, label: "___ shark", members: ["CARD", "POOL", "LOAN", "BASKING"] },
      { level: 3, label: "Sports cars", members: ["JAGUAR", "MUSTANG", "VIPER", "COBRA"] },
    ],
  },
  {
    groups: [
      { level: 0, label: "Breakfast foods", members: ["BACON", "CEREAL", "WAFFLE", "OMELET"] },
      { level: 1, label: "Breads", members: ["RYE", "PITA", "NAAN", "SODA"] },
      { level: 2, label: "___ board", members: ["KEY", "SURF", "CHESS", "DASH"] },
      { level: 3, label: "Letters, spelled out", members: ["BEE", "SEA", "WHY", "QUEUE"] },
    ],
  },
  {
    groups: [
      { level: 0, label: "Chess pieces", members: ["BISHOP", "ROOK", "KNIGHT", "QUEEN"] },
      { level: 1, label: "Card ranks", members: ["ACE", "JACK", "DEUCE", "TEN"] },
      { level: 2, label: "Poker hands", members: ["FLUSH", "STRAIGHT", "BOAT", "TRIPS"] },
      { level: 3, label: "Clergy", members: ["DEACON", "VICAR", "PRIEST", "CANON"] },
    ],
  },
  {
    groups: [
      { level: 0, label: "Citrus fruits", members: ["LEMON", "LIME", "ORANGE", "POMELO"] },
      { level: 1, label: "Shades of red", members: ["SCARLET", "CRIMSON", "MAROON", "RUST"] },
      { level: 2, label: "Gemstones", members: ["AMBER", "JADE", "OPAL", "RUBY"] },
      { level: 3, label: "Tomato varieties", members: ["CHERRY", "ROMA", "PLUM", "GRAPE"] },
    ],
  },
  {
    groups: [
      { level: 0, label: "Dog breeds", members: ["POODLE", "BEAGLE", "HUSKY", "PUG"] },
      { level: 1, label: "Poker actions", members: ["FOLD", "RAISE", "CALL", "CHECK"] },
      { level: 2, label: "Laundry verbs", members: ["WASH", "DRY", "PRESS", "STARCH"] },
      { level: 3, label: "Boxing weights", members: ["FLY", "BANTAM", "FEATHER", "CRUISER"] },
    ],
  },
  {
    groups: [
      { level: 0, label: "Sea creatures", members: ["OCTOPUS", "SEAL", "DOLPHIN", "MANTA"] },
      { level: 1, label: "Casino regulars", members: ["WHALE", "SHARK", "FISH", "DONKEY"] },
      { level: 2, label: "Farm animals", members: ["GOAT", "MULE", "HEN", "SOW"] },
      { level: 3, label: "Slot symbols", members: ["CHERRY", "SEVEN", "BELL", "BAR"] },
    ],
  },
  {
    groups: [
      { level: 0, label: "Blackjack moves", members: ["HIT", "STAND", "SPLIT", "SURRENDER"] },
      { level: 1, label: "Baseball actions", members: ["BUNT", "STEAL", "SLIDE", "PITCH"] },
      { level: 2, label: "Roulette bets", members: ["RED", "ODD", "EVEN", "STREET"] },
      { level: 3, label: "___ jack", members: ["LUMBER", "FLAP", "CAR", "BLACK"] },
    ],
  },
  {
    groups: [
      { level: 0, label: "Months", members: ["MARCH", "MAY", "JUNE", "AUGUST"] },
      { level: 1, label: "Ways to walk", members: ["STROLL", "AMBLE", "SAUNTER", "TRUDGE"] },
      { level: 2, label: "Tolerate", members: ["LET", "ALLOW", "SUFFER", "BROOK"] },
      { level: 3, label: "Dignified", members: ["REGAL", "STATELY", "LOFTY", "GRAND"] },
    ],
  },
  {
    groups: [
      { level: 0, label: "Pizza toppings", members: ["OLIVE", "ONION", "SAUSAGE", "MUSHROOM"] },
      { level: 1, label: "Salad greens", members: ["ROCKET", "KALE", "CHARD", "ENDIVE"] },
      { level: 2, label: "Wingless fliers", members: ["MISSILE", "SHUTTLE", "DRONE", "BALLOON"] },
      { level: 3, label: "___ pepper", members: ["BELL", "CHILI", "GHOST", "CAYENNE"] },
    ],
  },
  {
    groups: [
      { level: 0, label: "Poker hands", members: ["FLUSH", "STRAIGHT", "BOAT", "TRIPS"] },
      { level: 1, label: "Vacations", members: ["CRUISE", "TOUR", "SAFARI", "JAUNT"] },
      { level: 2, label: "Web browsers", members: ["CHROME", "EDGE", "OPERA", "FIREFOX"] },
      { level: 3, label: "Music venues", members: ["ARENA", "THEATER", "HALL", "CLUB"] },
    ],
  },
  {
    groups: [
      { level: 0, label: "Coffee drinks", members: ["LATTE", "MOCHA", "ESPRESSO", "CORTADO"] },
      { level: 1, label: "Shades of brown", members: ["TAUPE", "SEPIA", "UMBER", "CHESTNUT"] },
      { level: 2, label: "Young animals", members: ["FOAL", "COLT", "CUB", "CALF"] },
      { level: 3, label: "Joke", members: ["JEST", "GAG", "QUIP", "KID"] },
    ],
  },
  {
    groups: [
      { level: 0, label: "Precipitation", members: ["RAIN", "SNOW", "HAIL", "SLEET"] },
      { level: 1, label: "Greet warmly", members: ["SALUTE", "WELCOME", "CHEER", "TOAST"] },
      { level: 2, label: "Bakery items", members: ["LOAF", "CRUST", "ROLL", "BUN"] },
      { level: 3, label: "Haircuts", members: ["BOB", "PERM", "SHAG", "PIXIE"] },
    ],
  },
  {
    groups: [
      { level: 0, label: "Bodies of water", members: ["LAKE", "POND", "BAY", "GULF"] },
      { level: 1, label: "Sports with a stick", members: ["GOLF", "POLO", "HOCKEY", "CRICKET"] },
      { level: 2, label: "Insects", members: ["BEETLE", "MOTH", "APHID", "WEEVIL"] },
      { level: 3, label: "Shirt styles", members: ["OXFORD", "HENLEY", "TEE", "TUNIC"] },
    ],
  },
  {
    groups: [
      { level: 0, label: "Kitchen tools", members: ["WHISK", "LADLE", "GRATER", "SPATULA"] },
      { level: 1, label: "Move quickly", members: ["DART", "BOLT", "DASH", "ZIP"] },
      { level: 2, label: "Fasteners", members: ["SCREW", "RIVET", "CLASP", "HOOK"] },
      { level: 3, label: "Punctuation", members: ["COLON", "COMMA", "HYPHEN", "TILDE"] },
    ],
  },
  {
    groups: [
      { level: 0, label: "Trees", members: ["OAK", "MAPLE", "BIRCH", "ELM"] },
      { level: 1, label: "Hockey gear", members: ["PUCK", "STICK", "SKATE", "PADS"] },
      { level: 2, label: "Freshwater fish", members: ["TROUT", "PERCH", "BASS", "PIKE"] },
      { level: 3, label: "Singing voices", members: ["TREBLE", "TENOR", "ALTO", "SOPRANO"] },
    ],
  },
  {
    groups: [
      { level: 0, label: "Desert animals", members: ["CAMEL", "SCORPION", "GECKO", "FENNEC"] },
      { level: 1, label: "Ballroom dances", members: ["TANGO", "WALTZ", "SALSA", "RUMBA"] },
      { level: 2, label: "Dips", members: ["HUMMUS", "QUESO", "TZATZIKI", "AIOLI"] },
      { level: 3, label: "NATO alphabet", members: ["FOXTROT", "ROMEO", "SIERRA", "KILO"] },
    ],
  },
  {
    groups: [
      { level: 0, label: "Card handling", members: ["DEAL", "SHUFFLE", "CUT", "DRAW"] },
      { level: 1, label: "Even score", members: ["STALEMATE", "DEADLOCK", "PUSH", "TIE"] },
      { level: 2, label: "Media buttons", members: ["REPEAT", "PAUSE", "SKIP", "REWIND"] },
      { level: 3, label: "A bargain", members: ["STEAL", "SNIP", "BUY", "VALUE"] },
    ],
  },
  {
    groups: [
      { level: 0, label: "Pasta shapes", members: ["PENNE", "FUSILLI", "RIGATONI", "ORZO"] },
      { level: 1, label: "Pasta sauces", members: ["PESTO", "ALFREDO", "MARINARA", "RAGU"] },
      { level: 2, label: "Italian cities", members: ["MILAN", "TURIN", "NAPLES", "VERONA"] },
      { level: 3, label: "Operas", members: ["AIDA", "CARMEN", "TOSCA", "OTELLO"] },
    ],
  },
  {
    groups: [
      { level: 0, label: "Things with keys", members: ["PIANO", "LOCK", "MAP", "LAPTOP"] },
      { level: 1, label: "Piano parts", members: ["PEDAL", "HAMMER", "BENCH", "LID"] },
      { level: 2, label: "Hand tools", members: ["WRENCH", "PLIERS", "CHISEL", "AWL"] },
      { level: 3, label: "Guitar parts", members: ["FRET", "BRIDGE", "NECK", "TUNER"] },
    ],
  },
  {
    groups: [
      { level: 0, label: "Nervous", members: ["ANTSY", "JITTERY", "EDGY", "TENSE"] },
      { level: 1, label: "Grammatical tenses", members: ["PAST", "FUTURE", "PRESENT", "PERFECT"] },
      { level: 2, label: "A gift", members: ["BOON", "FAVOR", "TOKEN", "TREAT"] },
      { level: 3, label: "Halloween", members: ["GHOST", "CANDY", "MASK", "PUMPKIN"] },
    ],
  },
  {
    groups: [
      { level: 0, label: "Bears", members: ["POLAR", "GRIZZLY", "PANDA", "SLOTH"] },
      { level: 1, label: "Slow movers", members: ["SNAIL", "TORTOISE", "SLUG", "MANATEE"] },
      { level: 2, label: "Punch", members: ["SOCK", "BELT", "CLOUT", "JAB"] },
      { level: 3, label: "Accessories", members: ["SCARF", "TIE", "GLOVE", "BROOCH"] },
    ],
  },
  {
    groups: [
      { level: 0, label: "Ancient Egypt", members: ["SPHINX", "PHARAOH", "PAPYRUS", "OBELISK"] },
      { level: 1, label: "Greek monsters", members: ["HYDRA", "MEDUSA", "CHIMERA", "MINOTAUR"] },
      { level: 2, label: "Constellations", members: ["ORION", "LYRA", "CYGNUS", "DRACO"] },
      { level: 3, label: "Venomous snakes", members: ["ADDER", "MAMBA", "VIPER", "TAIPAN"] },
    ],
  },
  {
    groups: [
      { level: 0, label: "Casino games", members: ["CRAPS", "KENO", "BACCARAT", "ROULETTE"] },
      { level: 1, label: "Things you roll", members: ["DOUGH", "DICE", "CIGAR", "LOG"] },
      { level: 2, label: "Slang for money", members: ["BREAD", "CLAMS", "LOOT", "SCRATCH"] },
      { level: 3, label: "Pastries", members: ["SCONE", "TART", "ECLAIR", "MUFFIN"] },
    ],
  },
  {
    groups: [
      { level: 0, label: "Compass points", members: ["NORTH", "SOUTH", "EAST", "WEST"] },
      { level: 1, label: "Parts of a ship", members: ["PORT", "STARBOARD", "BOW", "STERN"] },
      { level: 2, label: "Wines", members: ["MERLOT", "CHIANTI", "RIESLING", "SHIRAZ"] },
      { level: 3, label: "Strict", members: ["SEVERE", "HARSH", "GRAVE", "DOUR"] },
    ],
  },
];
