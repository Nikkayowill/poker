import "server-only";

/**
 * The answers Daily Wordle actually asks for.
 *
 * `server-only`. Everyone shares one board, so a browser holding this list has
 * not just cheated its own puzzle -- it can print the next year of them.
 *
 * ## Narrow on purpose
 *
 * The guess dictionary (wordle-dictionary.ts) is ~15,000 words; this is 751.
 * The asymmetry is the design: a player may *try* an obscure word, but must
 * never be *asked* for one. An answer nobody has heard of is not a hard
 * puzzle, it is an unfair one, and the whole point of a shared daily board is
 * that the difficulty was the same for everybody.
 *
 * Every entry here is also in the guess dictionary, which is not a coincidence
 * to be maintained by hand -- a test asserts it. An answer the game would
 * refuse to accept as a guess is unwinnable, and it would only surface on the
 * one day that word came up.
 *
 * At 751 words and one a day, the cycle runs over two years before repeating
 * (dailyIndex walks the pool rather than sampling it -- see daily.ts).
 *
 * Plurals ending in -s, past tenses in -ed and any word that reads as a proper
 * noun are deliberately absent: they are guessable but they make for cheap
 * boards, and the source dictionary is full of them.
 */

const ANSWERS = `
  about above abuse actor acute admit adopt adult after again agent agree ahead alarm album
  alert alike alive allow alone along alter among anger angle angry apart apple apply arena
  argue arise armor array arrow aside asset audio audit avoid awake award aware badly baker
  basic batch beach began begin being below bench birth black blade blame blank blast blend
  bless blind block blood board boost booth bound brain brand brave bread break breed brick
  bride brief bring broad broke brown brush build built bunch burst buyer cabin cable camel
  canal candy cargo carry carve catch cause cease chain chair chalk charm chart chase cheap
  check cheek cheer chess chest chief child chose chunk civil claim class clean clear clerk
  click cliff climb clock close cloth cloud coach coast color comic coral could count court
  cover crack craft crash crazy cream creek crime crisp cross crowd crown crude cruel crush
  curve cycle daily dance dealt death debut decay delay dense depth devil diary dirty doubt
  dough dozen draft drain drama drank drawn dream dress dried drink drive drove drown drunk
  dying eager eagle early earth eight elbow elder elect elite empty enemy enjoy enter entry
  equal error essay event every exact exist extra faith false fancy fatal fault favor feast
  fence fever fiber field fifth fifty fight final first flame flash fleet flesh float flood
  floor flour fluid flush focus force forge forth forty forum found frame fraud fresh front
  frost fruit fully funny giant given glass globe glory glove going grace grade grain grand
  grant grape graph grass grave great greed green greet grief grill gross group grown guard
  guess guest guide guilt habit handy happy harsh haste hasty heart heavy hedge hello hence
  hobby honey honor horse hotel house human humor hurry ideal image imply index inner input
  irony issue ivory jelly jewel joint judge juice knife knock known label labor large laser
  later laugh layer learn lease least leave legal lemon level light limit linen liver lobby
  local lodge logic loose lucky lunar lunch lying magic major maker march marsh match mayor
  meant medal media mercy merge merit merry metal meter midst might minor minus mixed model
  moist money month moral motor mount mouse mouth movie music naked nasty naval needy nerve
  never newly night noble noise north novel nurse occur ocean offer often olive onion onset
  opera orbit order organ other ought outer owner paint panel panic paper party pasta patch
  pause peace peach pearl pedal penny phase phone photo piano piece pilot pinch pitch pivot
  pizza place plain plane plant plate plaza point polar porch pound power press price pride
  prime print prior prize probe proof proud prove pulse punch pupil puppy purse queen query
  quest queue quick quiet quilt quite quota quote radar radio raise rally ranch range rapid
  ratio reach react ready realm rebel refer relax relay renew reply rider ridge rifle right
  rigid rinse risky rival river roast robin robot rocky rough round route royal rugby ruler
  rural sadly saint salad salon sauce scale scare scene scent scope score scrap screw seize
  sense serve seven shade shaft shake shall shame shape share shark sharp sheep sheer sheet
  shelf shell shift shine shirt shock shoot shore short shown sight silly since sixth sixty
  skill skirt slate sleep slice slide slope small smart smell smile smoke snake sneak solar
  solid solve sorry sound south space spare spark speak speed spell spend spice spike spine
  spite split spoke sport spray squad stack staff stage stain stair stake stamp stand stare
  start state steam steel steep steer stern stick stiff still sting stock stole stone stood
  stool store storm story stove strap straw strip study stuff style sugar suite sunny super
  surge sweat sweep sweet swift swing sword table taken taste teach teeth tempo tenth thank
  theft their theme there these thick thief thing think third thorn those three threw throw
  thumb tiger tight timer tired title toast today token tooth topic torch total touch tough
  tower toxic trace track trade trail train trait trash treat trend trial tribe trick tried
  troop truck truly trunk trust truth tulip tumor twice twist uncle under union unite unity
  until upper upset urban usage usual vague valid value valve vapor vault venue verse video
  vigor villa vinyl viral virus visit vital vivid vocal voice voter wagon waste watch water
  weary weigh weird whale wheat wheel where which while white whole whose widow width witch
  woman world worry worse worst worth would wound wrist write wrong yacht yield young youth
  zebra
`;

export const WORDLE_ANSWERS: readonly string[] = ANSWERS.trim().split(/\s+/);
