/**
 * What two people on the farm say to each other when they stop for a chat.
 *
 * A chat is a topic and a few short lines, one after the other, each in the speaker's own voice. Topics
 * are about the place they share (the hens, the well, the pond, the weather, supper) so it reads as small
 * talk, not a script: the same pair rarely gets the same topic twice running, and the opener is either of
 * them. Lines are short enough to fit a small bubble.
 *
 * Pure and seedable, tested without Phaser (npc-talk.test.ts).
 */

export type Topic = "hens" | "well" | "pond" | "sky" | "supper" | "farmer" | "work" | "pair";

export interface Line {
  /** Who says it. */
  who: string;
  text: string;
  /** Ms after the chat starts that the line appears. */
  at: number;
}

export interface Chat {
  topic: Topic;
  lines: Line[];
  /** Ms from the start until the last line has been read. */
  duration: number;
}

type SharedTopic = Exclude<Topic, "pair">;
interface Voice {
  topics: Record<SharedTopic, { open: string[]; reply: string[] }>;
  /** Short acknowledgements, the "mm" of someone listening. */
  nod: string[];
}

/**
 * Each person's way of saying it, from how the story writes them (lib/stackacres/story/dialogue.ts): Ray the
 * unhurried pioneer with a proverb for most things, Pierre the excitable retro chef who is delighted by dirt,
 * and Ivy the botanist who is thrilled by anything that does not sit on a grid. `open` starts a topic, `reply`
 * answers whoever did.
 */
const VOICES: Record<string, Voice> = {
  ray: {
    nod: ["Mm.", "Aye.", "That so."],
    topics: {
      hens: { open: ["Those hens are in a mood today.", "Counted the hens twice. Same both times."], reply: ["A hen knows who feeds her.", "Stubborn birds. Good birds."] },
      well: { open: ["Well's running sweet this year.", "Cold enough to ache your teeth."], reply: ["Never once let me down.", "Dug the first of it myself."] },
      pond: { open: ["Anybody catch anything?", "Bass'll bite by supper. Mark me."], reply: ["Fish keep their own hours.", "Don't tell me where. I'll want to go."] },
      sky: { open: ["Feels like weather coming in.", "Good growing sky today."], reply: ["My knee says rain. It's never wrong.", "A farm is patience with a fence around it."] },
      supper: { open: ["Getting on toward supper.", "Somebody's stew is on. I can smell it."], reply: ["Best part of any day.", "Set a place. There's always room."] },
      farmer: { open: ["Our farmer's coming along.", "That one's got the hands for it."], reply: ["Reminds me of me, once.", "The land's in good hands."] },
      work: { open: ["Always one more job.", "The oxen never asked when we'd be done."], reply: ["Slow and steady gets it done.", "That's how you know it's home."] },
    },
  },
  pierre: {
    nod: ["Oui, oui.", "Ah, bien sur.", "Hmm! Yes!"],
    topics: {
      hens: { open: ["Ze hen! She looked at my apron!", "Zis egg is WARM. Nothing was warm at home."], reply: ["She is judging my soup, I know it.", "In my kitchen, eggs were four pixels."] },
      well: { open: ["Ze water is wet! Incroyable!", "Race you to ze well!"], reply: ["I am parched already, mon ami.", "Too slow, too slow!"] },
      pond: { open: ["Do you think zere is a big one?", "I would fish, but I would fall in."], reply: ["Catch me a fish. I will make magic.", "Bah, I would catch a boot."] },
      sky: { open: ["Look at zose clouds! No two ze same.", "Ze weather changes! Nobody told me."], reply: ["In my world it was always noon.", "Not one sprite in sight. Beautiful."] },
      supper: { open: ["I could eat ze whole pot.", "Is it supper yet? Now?"], reply: ["You said zat an hour ago.", "I will carry ze plates!"] },
      farmer: { open: ["Ze farmer brings potatoes with dirt!", "Zat farmer never sits still."], reply: ["Same as me, no?", "I like zem. Zey are lumpy."] },
      work: { open: ["Too many dishes, too little time.", "My back says stop. I say non."], reply: ["We are doing magnifique.", "Just one more pot."] },
    },
  },
  ivy: {
    nod: ["Right, right.", "Yes! Exactly.", "Huh. Okay."],
    topics: {
      hens: { open: ["Hens aren't random. Just unlogged.", "Six hens. Zero pattern. I love it."], reply: ["I tried to model their pecking. Failed.", "Chaos with feathers."] },
      well: { open: ["The water level never changes. Suspicious.", "Hear that echo? Free reverb."], reply: ["Okay, okay, it's just water.", "I checked twice. It's a well."] },
      pond: { open: ["Lily pads! Every one different!", "Nothing in that pond is on a grid."], reply: ["I can't stop looking at it.", "Ray says the fish are moody."] },
      sky: { open: ["The clouds don't tile. Anywhere.", "Light this uneven should be a bug."], reply: ["Best bug I've ever seen.", "I stopped trying to fix it."] },
      supper: { open: ["Is there soup? I forgot to eat.", "I skipped lunch debugging a bean."], reply: ["Pierre's cooking is the one table I trust.", "Save me a bowl?"] },
      farmer: { open: ["The farmer's beds are WILD.", "Every harvest surprises me. Every one."], reply: ["I'm writing a whole new table for them.", "Best data I've ever had."] },
      work: { open: ["Sorry, I lost my place. Again.", "I have forty notes and no filing system."], reply: ["That's fine. It's fine.", "I'll get there."] },
    },
  },
};

/**
 * Things only these two would say to each other. People are written through each other as much as through
 * themselves: Ray does not know what Pierre's dirt is for, Ivy can't find a pattern in Ray's beds. Keyed by
 * the two names sorted; each exchange is 2 or 3 lines, fixed speakers.
 */
const PAIRS: Record<string, [string, string][][]> = {
  "ivy|pierre": [
    [["pierre", "Ivy, zis carrot is crooked!"], ["ivy", "Not crooked. Non-linear."], ["pierre", "Zen I cook a non-linear soup."]],
    [["ivy", "Pierre, does your kitchen have a save file?"], ["pierre", "Non! Burn ze soup, it stays burned."], ["ivy", "Terrifying. I love it."]],
  ],
  "ivy|ray": [
    [["ivy", "Ray, how did you know where to plant?"], ["ray", "Didn't. Put it in and waited."], ["ivy", "That's not a method! I love it."]],
    [["ray", "Found a pattern in the beds yet?"], ["ivy", "None! It's wonderful."]],
  ],
  "pierre|ray": [
    [["pierre", "Ray! Zis dirt, it is PERFECT!"], ["ray", "Dirt's just dirt, friend."], ["pierre", "Nothing is 'just' anything."]],
    [["ray", "Something smells good."], ["pierre", "Zat is ze onions. And my pride."]],
  ],
};

const ORDER: SharedTopic[] = ["hens", "well", "pond", "sky", "supper", "farmer", "work"];

/** The topics that suit the time of day: nobody talks about supper at dawn. */
function topicsFor(hour: number): SharedTopic[] {
  return ORDER.filter((topic) => topic !== "supper" || (hour >= 11 && hour < 20));
}

/** Reading time for a line, in ms: a beat to start, then the length of it. */
function readMs(text: string): number {
  return 1300 + text.length * 32;
}

/**
 * Two people's chat. `lastTopic` is the topic they had last time (never picked again straight away). About
 * half the time it is an exchange only this pair would have; otherwise small talk on a shared topic, where
 * either can open, the other answers, and sometimes the opener gives a short nod to close.
 */
export function composeChat(a: string, b: string, hour: number, random: () => number, lastTopic?: Topic): Chat | null {
  const first = VOICES[a];
  const second = VOICES[b];
  if (!first || !second) return null;
  const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)];
  const exchanges = PAIRS[[a, b].sort().join("|")];
  let texts: [string, string][];
  let topic: Topic;
  if (exchanges && lastTopic !== "pair" && random() < 0.5) {
    topic = "pair";
    texts = pick(exchanges);
  } else {
    const options = topicsFor(hour).filter((option) => option !== lastTopic);
    topic = pick(options);
    const [opener, replier, openVoice, replyVoice] = random() < 0.5 ? [a, b, first, second] : [b, a, second, first];
    texts = [
      [opener, pick(openVoice.topics[topic].open)],
      [replier, pick(replyVoice.topics[topic].reply)],
    ];
    if (random() < 0.4) texts.push([opener, random() < 0.5 ? pick(openVoice.nod) : pick(openVoice.topics[topic].reply)]);
  }
  const lines: Line[] = [];
  let at = 0;
  for (const [who, text] of texts) {
    lines.push({ who, text, at });
    at += readMs(text);
  }
  return { topic, lines, duration: at };
}

/** Every line anyone can say, for tests that check them. */
export function allLines(): { who: string; topic: Topic; text: string }[] {
  const shared = Object.entries(VOICES).flatMap(([who, voice]) => ORDER.flatMap((topic) => [...voice.topics[topic].open, ...voice.topics[topic].reply].map((text) => ({ who, topic, text }))));
  const nods = Object.entries(VOICES).flatMap(([who, voice]) => voice.nod.map((text) => ({ who, topic: "work" as Topic, text })));
  const paired = Object.values(PAIRS).flatMap((list) => list.flatMap((lines) => lines.map(([who, text]) => ({ who, topic: "pair" as Topic, text }))));
  return [...shared, ...nods, ...paired];
}

/** The pairs that have exchanges of their own, as sorted names. */
export function pairKeys(): string[] {
  return Object.keys(PAIRS);
}

/** Who has something to say. */
export function talkers(): string[] {
  return Object.keys(VOICES);
}
