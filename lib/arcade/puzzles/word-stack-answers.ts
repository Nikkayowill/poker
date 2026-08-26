import "server-only";

/**
 * The answers Daily Word Stack actually asks for.
 *
 * `server-only`. Everyone shares one board, so a browser holding this list
 * has not just cheated its own puzzle, it can print the next year of them.
 *
 * The guess dictionary (word-stack-dictionary.ts) is ~15,000 words; this is
 * 1,119. The asymmetry is the design: a player may try an obscure word, but
 * must never be asked for one. An answer nobody has heard of is not a hard
 * puzzle, it is an unfair one, and the whole point of a shared daily board
 * is that the difficulty is the same for everybody.
 *
 * Every entry here is also in the guess dictionary, which a test asserts
 * rather than leaving to hand-maintenance. An answer the game would refuse
 * to accept as a guess is unwinnable, and it would only surface on the one
 * day that word came up.
 *
 * At 1,119 words and one a day, the cycle runs about three years before
 * repeating (dailyIndex walks the pool rather than sampling it, see
 * daily.ts).
 *
 * Plurals ending in -s, past tenses in -ed, and any word that reads as a
 * proper noun are absent: they're guessable but make for cheap boards, and
 * the source dictionary is full of them.
 */

const ANSWERS = `
  abbey about above abuse acorn actor acute adieu admit adopt adorn adult afoot after again
  agent agony agree ahead alarm album alert algae alike alive allow alloy alone along alter
  amber among amuse angel anger angle angry ankle anvil apart apple apply apron arena argue
  arise armor aroma array arrow arson ashen aside asset atlas attic audio audit aunty avert
  avoid awake award aware awful bacon badge badly bagel baker balmy banjo baron basic basil
  batch beach beard beast began begin being belly below bench berry bible birth bison black
  blade blame blank blast blaze blend bless blind bloat block blood bluff blunt board boast
  bogey bonus boost booth booty borax bosom bough bound bowel brace braid brain brand brave
  brawl bread break breed briar brick bride brief brine bring brink briny broad broke broom
  brown brush brute buggy build built bulky bunch bunny burly burst bushy butch buyer cabin
  cable caddy camel canal candy canoe caper carat cargo carry carve catch cause cease chain
  chair chalk champ chant charm chart chase cheap check cheek cheer chess chest chief child
  chill chirp chive chore chose chunk churn cider civic civil claim clamp clasp class clean
  clear clerk click cliff climb cling clock close cloth cloud clove clown coach coast cocoa
  color comet comic condo conic coral cough could count coupe court cover crack craft crank
  crash crave crawl crazy creak cream creed creek creep crest crime crimp crisp croak crock
  crook cross crowd crown crude cruel crumb crush crypt cubic curly curve cycle daddy daily
  daisy dance dandy dealt death debut decay decoy delay delta demon dense depot depth devil
  diary dirty dizzy dodge doubt dough dowry dozen draft drain drama drank drape drawn dread
  dream dress dried drift drill drink drive droop drove drown drunk dryer ducat dwell dying
  eager eagle early earth eight elbow elder elect elite elope emote empty enact enemy enjoy
  ensue enter entry envoy epoxy equal equip erect error erupt essay ether event every evoke
  exact exile exist extra fable facet faint fairy faith false fancy fatal fault fauna favor
  feast felon fence ferry fetch fever fiber field fifth fifty fight final finch first flair
  flame flare flash flask fleck fleet flesh flick flint float flock flood floor flour fluid
  flush flute focus foggy folly force forge forth forty forum fossa found foyer frail frame
  frank fraud fresh frisk front frost frown fruit fudge fully funny fuzzy gable gaily gauze
  genie giant given glass globe glory glove gnome going goose gouge grace grade grain grand
  grant grape graph grass grave gravy great greed green greet grief grill groom gross group
  grove growl grown guard guess guest guide guilt gumbo gutsy habit haiku halve handy happy
  harsh haste hasty hazel heart heavy hedge hello hence heron hinge hippo hoard hobby honey
  honor horde horse hotel hound house human humor hurry husky hydra hyena ideal igloo image
  imply index inner input irony issue ivory jelly jerky jewel jiffy joint joker jolly joust
  judge juice jumbo juror karma kayak knife knock known koala label labor lager lance lapel
  larch large laser lasso later laugh layer learn lease least leave legal lemon level light
  limit linen liver llama lobby local lodge logic loose loyal lucky lumen lunar lunch lupin
  lurch lying lyric magic magma major maker mango manor maple march marsh match mayor meant
  medal media melon mercy merge merit merry metal meter midge midst might minor minus mixed
  mocha model moist molar money month moose moral motor motto mound mount mouse mousy mouth
  movie mulch mummy mural mused music nacho naked nasal nasty naval navel needy nerdy nerve
  never newly niche night noble noise north novel nudge nurse oasis obese occur ocean offal
  offer often olive onion onset opera orbit order organ other otter ought outer ovary owner
  ozone pagan paint panda panel panic paper party pasta paste patch patio pause peace peach
  pearl pecan pedal penny perch petal phase phone photo piano piece piety pilot pinch pitch
  pivot pixel pizza place plaid plain plane plank plant plate plaza pluck plumb plush poach
  point polar polka poppy porch potty pound power prawn press price pride prime print prior
  prize probe prong proof proud prove prowl prune pulse punch pupil puppy purse quack quail
  quake queen query quest queue quick quiet quill quilt quirk quite quota quote rabid radar
  radio raise rally ranch range rapid ratio ravel raven razor reach react ready realm rebel
  recur refer reign relax relay relic renew reply revue rhino rider ridge rifle right rigid
  rinse risky rival river roast robin robot rocky rodeo rough round route rowdy royal rugby
  ruler rumor rural sable sadly saint salad salon salsa satin sauce sauna scald scale scare
  scarf scene scent scoop scope score scowl scrap screw scrub scuba seize sense serve seven
  shade shaft shake shale shall shame shape share shark sharp sheaf sheep sheer sheet shelf
  shell shift shine shirt shock shoot shore short shown shrug siege sight silly since sixth
  sixty skill skirt skunk slant slate sleek sleep sleet slice slide slope sloth slush small
  smart smell smile smoke snack snake snarl sneak solar solid solve sonic sorry sound south
  space spare spark spawn speak speed spell spend spice spike spiky spine spite split spoke
  spoof spool sport spout spray spurn squad stack staff stage stain stair stake stalk stamp
  stand stare stark start state steam steed steel steep steer stein stern stick stiff still
  sting stint stock stoic stole stone stood stool store stork storm story stout stove strap
  straw strip strut study stuff stump style suede sugar suite sunny super surge sushi swamp
  sweat sweep sweet swift swing swirl swoop sword syrup tabby table taken tally talon tango
  tapir taste teach teeth tempo tenth tepee thank theft their theme there these thick thief
  thing think third thorn those three threw throw thumb thump tiara tiger tight timer timid
  tired title toast today token tonic tooth topic torch torso total touch tough towel tower
  toxic toxin trace track trade trail train trait trash treat trend trial tribe trice trick
  tried troop truck truly trunk trust truth tulip tumor turbo tweed twice twine twist udder
  ulcer ultra umbra uncle under unify union unite unity until upper upset urban usage usher
  usual utter vague valid valor value valve vapor vault venue verse vetch video vigil vigor
  villa vinyl viper viral virus visit vital vivid vixen vocal vodka voice voter vowel wafer
  wager wagon waltz warty waste watch water weary wedge weigh weird whale wheat wheel whelp
  where which whiff while whirl whisk white whole whose widow width wince witch witty woman
  wooly world worry worse worst worth would wound wrath wreck wring wrist write wrong xenon
  yacht yeast yield yodel young youth yucky zebra zesty
`;

export const WORD_STACK_ANSWERS: readonly string[] = ANSWERS.trim().split(/\s+/);
