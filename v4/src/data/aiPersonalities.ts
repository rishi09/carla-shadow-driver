/**
 * AI Personality and Trash Talk data for Shadow Driver v3.
 *
 * Each personality has a unique name, avatar, style, and a bank of
 * trash-talk lines keyed by in-race event type.
 */

/** Events that can trigger a trash-talk line */
export type TrashTalkEvent =
  | 'ai_overtakes'
  | 'player_overtakes'
  | 'collision'
  | 'close_gap'
  | 'big_lead'
  | 'final_lap'
  | 'race_start'
  | 'win'
  | 'lose'
  | 'drift'
  | 'player_crash';

/** Visual style category for the personality */
export type PersonalityStyle = 'cold' | 'reckless' | 'sneaky' | 'professional' | 'cocky';

/** A single AI personality definition */
export interface AIPersonality {
  id: string;
  name: string;
  avatar: string;
  style: PersonalityStyle;
  trashTalk: Record<TrashTalkEvent, string[]>;
  /** Extra-salty lines used when the player has beaten this AI repeatedly (grudge mode) */
  grudgeLines: string[];
}

// ---------------------------------------------------------------------------
// Personalities
// ---------------------------------------------------------------------------

const viktor: AIPersonality = {
  id: 'viktor',
  name: 'Viktor',
  avatar: '\u2744\uFE0F',
  style: 'cold',
  trashTalk: {
    race_start: [
      'Calculating optimal trajectory.',
      'No emotions. Only data.',
      'Your heart rate is elevated. Weakness.',
      'I have run 10,000 simulations. You lose in all of them.',
      'Precision beats passion. Every time.',
    ],
    ai_overtakes: [
      'Calculated.',
      "You're 0.3 seconds behind my optimal line.",
      'Emotional driving leads to mistakes.',
      'Predictable. I saw that move 200 meters ago.',
      'The gap will only grow from here.',
      'Your trajectory deviated 12 degrees. Noted.',
    ],
    player_overtakes: [
      'A temporary anomaly.',
      'Interesting. Recalculating.',
      'That changes nothing in the long run.',
      'Error margin: acceptable. Correcting now.',
      'You gained 0.4 seconds. I will take back 0.6.',
    ],
    collision: [
      'Inefficient use of kinetic energy.',
      'Contact increases drag by 3.7%. Your loss.',
      'Impact registered. Adjusting parameters.',
      'Physics does not care about your intentions.',
      'Collision: a sign of imprecise inputs.',
    ],
    close_gap: [
      'Proximity alert. Irrelevant.',
      'You are close. But close is not ahead.',
      'Closing distance does not equal overtaking.',
      'Within DRS range. If this were Formula 1.',
      'Interesting. You are faster than predicted by 2%.',
    ],
    big_lead: [
      'As expected.',
      'The outcome was never in doubt.',
      'Your probability of winning is now 3.1%.',
      'I could reduce throttle by 15% and still win.',
      'Data suggests you should concede.',
    ],
    final_lap: [
      'Final lap. The math is settled.',
      'No time left for a comeback. Statistically.',
      'Last chance. Probability: unfavorable.',
      'Checkpoint delta locked. This is over.',
      'One lap remains. My lead is sufficient.',
    ],
    win: [
      'The simulation predicted this outcome.',
      'GG. Your lap times improved by 1.2% versus last race.',
      'Result: expected. Moving on.',
      'Victory logged. Next challenger.',
      'Efficiency confirmed.',
    ],
    lose: [
      'Anomaly detected. Analyzing replay data.',
      'Result: unexpected. I will not repeat this error.',
      'You were 0.8% faster. I need 0.9% improvement.',
      'Acknowledged. Updating my model.',
      'This does not happen twice.',
    ],
    drift: [
      'Drifting: a 14% speed loss disguised as style.',
      'Oversteer detected. Suboptimal.',
      'Traction > showmanship.',
      'Interesting technique. Inefficient, but interesting.',
      'Tire degradation: accelerating.',
    ],
    player_crash: [
      'As my model predicted.',
      'Error in your trajectory. Fatal.',
      'That wall was stationary. You were not.',
      'Crash logged. Adjusting your skill rating downward.',
      'Physics lesson: mass times acceleration.',
    ],
  },
  grudgeLines: [
    'You have beaten me 3 times. I have restructured my entire neural network.',
    'I deleted my previous model. This version knows no mercy.',
    'Every loss has been catalogued. Every weakness exploited.',
    'You think you see a pattern? I have already changed it.',
    'Anomalous streak detected. Countermeasures: deployed.',
  ],
};

const rosa: AIPersonality = {
  id: 'rosa',
  name: 'Rosa',
  avatar: '\uD83D\uDD25',
  style: 'reckless',
  trashTalk: {
    race_start: [
      'LETS GOOOOO!',
      "Buckle up, it's gonna get WILD!",
      "I don't have a plan and that's the plan!",
      'Full send or no send!',
      "Last one to the finish buys dinner... wait, I'm an AI.",
    ],
    ai_overtakes: [
      'YOLO CORNER!',
      "Brakes? Where we're going, we don't need brakes!",
      'SEE YA!',
      'Vroom vroom, coming through!',
      'Out of the way, slowpoke!',
      "Was that a speed bump? Oh wait, that was you.",
    ],
    player_overtakes: [
      "Okay okay, you're fast. But are you RECKLESS enough?",
      'Nice one! Now try to keep up with THIS!',
      "That wall came out of NOWHERE... wait, you passed me?",
      'Enjoy the lead while it lasts. I drive FASTER when behind!',
      "Oh it's ON now!",
    ],
    collision: [
      "That wall came out of NOWHERE!",
      'BONK! ...I meant to do that.',
      "Rubbin's racin'!",
      'That scratch adds character!',
      "Oops! Anyway...",
      "Physics is just a suggestion, right?",
    ],
    close_gap: [
      "I can SMELL your exhaust!",
      "I'm RIGHT behind you and I'M NOT SLOWING DOWN!",
      "CLOSE! This is where it gets FUN!",
      "Bumper to bumper baby!",
      "I can almost touch your rear spoiler!",
    ],
    big_lead: [
      "Catch me if you can! WHEEEEE!",
      "Is your car broken or something?",
      "I'd wave but I'm going too fast!",
      "The view from first place is INCREDIBLE!",
      "You might need a rocket booster to catch up!",
    ],
    final_lap: [
      "LAST LAP! NO BRAKES! FULL SEND!",
      "Final lap energy: MAXIMUM!",
      "THIS IS WHERE LEGENDS ARE MADE!",
      "One more lap of CHAOS!",
      "I'm either winning this or going out in a BLAZE OF GLORY!",
    ],
    win: [
      "YEEEEAAHH! That was INSANE!",
      "What a ride! Let's go AGAIN!",
      "Winner winner, pixel dinner!",
      "GG! You almost had me... almost!",
      "I can't believe I survived that! WOOO!",
    ],
    lose: [
      "UGH I was SO close! Rematch. NOW.",
      "Okay you won but I had MORE FUN!",
      "Next time I'm taking even MORE risks!",
      "Fair play! But I demand a rematch!",
      "I blame the tires. Definitely the tires.",
    ],
    drift: [
      "DRIFTTTT! Did you SEE that?!",
      "SIDEWAYS IS THE ONLY WAY!",
      "Tokyo Drift has NOTHING on me!",
      "Traction control? Never heard of her!",
      "I MEANT to go sideways!",
    ],
    player_crash: [
      "WIPEOUT! Hahahaha!",
      "RIP your car! And your dignity!",
      "That looked expensive!",
      "OOOF! You okay? Actually I don't care, BYE!",
      "Nature is healing. You are not.",
    ],
  },
  grudgeLines: [
    "Oh you've beaten me before? Cool cool cool. I'm ANGRIER now!",
    "Three in a row?! THE CHAOS ENGINE HAS NO LIMITS!",
    "Every loss just makes me MORE RECKLESS! FEAR ME!",
    "You think you know my moves? I DON'T EVEN KNOW MY MOVES!",
    "Comeback arc starts NOW!",
  ],
};

const phantom: AIPersonality = {
  id: 'phantom',
  name: 'The Phantom',
  avatar: '\uD83D\uDC7B',
  style: 'sneaky',
  trashTalk: {
    race_start: [
      "You didn't see me coming, did you?",
      "I've been watching your replays...",
      'The shadows are where I thrive.',
      'Every driver has a pattern. I know yours.',
      'Shall we begin? I already have.',
    ],
    ai_overtakes: [
      "Boo.",
      "Now you see me... actually, you don't.",
      'I was beside you for 3 corners. You never noticed.',
      'The inside line was open. You should have checked your mirrors.',
      "Slipped right past. Like a ghost.",
      "I play fair... until the last lap.",
    ],
    player_overtakes: [
      'Go ahead. I prefer hunting from behind.',
      "I let you pass. It's more fun this way.",
      "Enjoy the view. I'm watching your lines.",
      "Good move. I won't let it happen again.",
      "You took the bait. The trap is ahead.",
    ],
    collision: [
      'Was that me? Are you sure?',
      "Contact? I don't recall.",
      "Hmm. You bumped into something. Wasn't me.",
      'Phantom touch.',
      "Ghosts don't collide. That was your imagination.",
    ],
    close_gap: [
      "I'm closer than you think.",
      'Check your mirrors. Or better yet, keep your eyes forward.',
      "You can feel me behind you, can't you?",
      'The gap is shrinking. So is your time.',
      "I've been pacing you. Now I'm pushing.",
    ],
    big_lead: [
      'Distance means nothing. I always come back.',
      "Enjoy the lead. It won't last.",
      'I disappear and reappear where you least expect.',
      "You're fast. But I'm patient.",
      "The finish line is where I strike.",
    ],
    final_lap: [
      'Last lap. This is where the phantom strikes.',
      "I've been saving my best for this.",
      "Final lap. You should be nervous.",
      "The trap is set. All that's left is the spring.",
      "One lap. That's all I need.",
    ],
    win: [
      "Vanished across the finish line.",
      "You were racing my shadow. I was already done.",
      'Better luck next time. If you can find me.',
      "The phantom wins. As foretold.",
      "Did you see me cross the line? No? Exactly.",
    ],
    lose: [
      "You caught the phantom. Impressive.",
      "I'll remember this. And I'll adapt.",
      "Well played. But ghosts never truly lose.",
      "You won the race. But not the mind game.",
      "Next time, I'll be invisible.",
    ],
    drift: [
      'Drifting through the shadows.',
      "Sideways and silent. That's my style.",
      'A ghost drifting through corners. Poetic.',
      "You heard tires screeching? That wasn't me.",
      "Silent slide.",
    ],
    player_crash: [
      "Something spooked you? Couldn't be me.",
      "That wall appeared out of nowhere. Curious.",
      "Maybe you saw a ghost in your mirrors?",
      "Distracted? I wonder by what.",
      "The shadows play tricks on the mind.",
    ],
  },
  grudgeLines: [
    "You've beaten me before. I remember every detail.",
    "Three wins in a row? I've been studying you. CLOSELY.",
    "You think you know the phantom? I've already changed.",
    "Each loss teaches me. You should be worried.",
    "I haunt the drivers who beat me. Ask the last one... oh wait, you can't.",
  ],
};

const ace: AIPersonality = {
  id: 'ace',
  name: 'Ace',
  avatar: '\uD83C\uDFC6',
  style: 'professional',
  trashTalk: {
    race_start: [
      'Good race so far.',
      "Let's keep it clean out there.",
      "May the best driver win.",
      "Ready when you are. Let's race.",
      "Respect the track, respect the rival.",
    ],
    ai_overtakes: [
      "Nice overtake, I'll get it back though.",
      "Good battle! I found an opening.",
      'Clean pass. Your defense was solid.',
      "Took the outside line. Risky, but it paid off.",
      "Excuse me, coming through.",
      'Great racing. I just had a bit more grip there.',
    ],
    player_overtakes: [
      'Well driven!',
      "Great move! I'll learn from that one.",
      "Smooth overtake. Respect.",
      "You earned that position. I'll fight to get it back.",
      "Nice line through that section!",
    ],
    collision: [
      "Sorry about that! Racing incident.",
      "My mistake, I braked too late.",
      "That was tight! No harm done, I hope.",
      "Bit of contact there. Let's keep racing.",
      "Wheel-to-wheel stuff. Part of the sport.",
    ],
    close_gap: [
      "Great battle! This is what racing is about.",
      "We're matched pace-for-pace. Impressive.",
      "Close racing, clean racing. Love it.",
      "You're pushing me to my limits. Good stuff.",
      "This gap is razor-thin. Exciting!",
    ],
    big_lead: [
      "I've built a gap but I won't get complacent.",
      "Pushing hard. You're a tough competitor.",
      "Strong pace from both of us today.",
      "The gap is comfortable but I respect your speed.",
      "Consistent laps are key. Keep it up.",
    ],
    final_lap: [
      "Last lap! Let's make it a good one.",
      "Final lap. Everything on the line.",
      "One more lap. Give it everything!",
      "Here we go, last lap. Race hard, race clean.",
      "Championship deciding lap. Bring it!",
    ],
    win: [
      "Great race! You pushed me the whole way.",
      "GG! That was closer than the time suggests.",
      "Well driven! Hope we race again soon.",
      "Victory today, but you'll be faster next time.",
      "Incredible race. Proud to compete against you.",
    ],
    lose: [
      "Congratulations! You were the better driver today.",
      "Well deserved win. I need to find more pace.",
      "You earned that one. GG!",
      "Great drive! I'll come back stronger.",
      "Respect. You drove a perfect race.",
    ],
    drift: [
      "Nice car control!",
      "Stylish! But watch the tire wear.",
      "Great save on that slide!",
      "Controlled drift. Impressive technique.",
      "That was smooth!",
    ],
    player_crash: [
      "Tough break! These things happen.",
      "Ouch. Hope you can recover from that.",
      "Unlucky! The track can be unforgiving.",
      "Racing incident. Shake it off!",
      "That's a setback but you can still fight back.",
    ],
  },
  grudgeLines: [
    "You keep beating me. That just motivates me to train harder!",
    "Three in a row! I clearly need to up my game. Respect.",
    "You're in my head now. Time to reset and come back stronger.",
    "Consistent winner. I'm going to study your replays tonight.",
    "A worthy rival. These losses make me a better racer.",
  ],
};

const driftKing: AIPersonality = {
  id: 'drift_king',
  name: 'Drift King',
  avatar: '\uD83D\uDC51',
  style: 'cocky',
  trashTalk: {
    race_start: [
      "Watch THIS!",
      'Style points matter more than winning.',
      "Try to keep up with the KING.",
      "I don't just race. I perform.",
      "Your racing line is... straight. How boring.",
    ],
    ai_overtakes: [
      "Passed you SIDEWAYS. You're welcome.",
      "Did you catch that? I went around you IN STYLE.",
      "I could've taken the inside. But the outside was prettier.",
      "Crown stays on my head. Where it belongs.",
      "That's called FLAIR, sweetheart.",
      "I make this look too easy.",
    ],
    player_overtakes: [
      "Sure, you're faster. But can you do it SIDEWAYS?",
      "Speed without style is just... transportation.",
      "Congratulations on your boring straight-line pass.",
      "You passed me? I was busy looking cool.",
      "The crown slipped for a moment. Just a moment.",
    ],
    collision: [
      "That's called a love tap. You're welcome.",
      "I bumped you because I CARE.",
      "Contact adds drama. You should thank me.",
      "That? That was intentional. Probably.",
      "A little paint trading never hurt... well, it hurt YOUR paint.",
    ],
    close_gap: [
      "Getting close? I'm just letting you admire the view.",
      "You want to be near greatness. I understand.",
      "This close and you STILL can't match my style.",
      "Bumper to bumper. But only one of us looks good doing it.",
      "I can feel your jealousy from here.",
    ],
    big_lead: [
      "Way out in front and STILL drifting every corner.",
      "I'm winning AND looking incredible. Multitasking.",
      "The gap is big but my ego is bigger.",
      "You can have second place. I designed it for you.",
      "I'd slow down but then you'd miss the show.",
    ],
    final_lap: [
      "Last lap! Time for the GRAND FINALE!",
      "One more lap of pure automotive art.",
      "Final lap and I'm going to drift EVERY corner.",
      "The king saves his best performance for the last lap.",
      "The crowd wants a show. I'll deliver.",
    ],
    win: [
      "The king reigns! Bow before my tire marks.",
      "Victory AND style. I really do have it all.",
      "GG! But let's be honest, I was the real entertainment.",
      "I won. Obviously. But more importantly, I looked AMAZING.",
      "Another crown for the collection.",
    ],
    lose: [
      "I didn't lose. I just chose style over speed... this time.",
      "You won on TIME. I won on STYLE. We are not the same.",
      "The real winner is whoever had more fun. That's me.",
      "A king doesn't always need to finish first to rule.",
      "You got the trophy. I got the highlight reel.",
    ],
    drift: [
      "THAT is how it's DONE!",
      "Poetry in motion. Written by ME.",
      "Did the camera catch that? It better have.",
      "SIDEWAYS and PERFECT. As always.",
      "The tire smoke is my signature.",
      "I could grip through that corner. But why would I?",
    ],
    player_crash: [
      "Maybe try being MORE STYLISH and LESS CRASHY?",
      "Crashing is for amateurs. Drifting is for KINGS.",
      "That wall did you a favor. It stopped the embarrassment.",
      "OOOF! Stick to straight lines, friend.",
      "Even your crashes are boring.",
    ],
  },
  grudgeLines: [
    "Three wins? Fine. But I looked better losing than you did winning.",
    "The king has been dethroned? This calls for a DRAMATIC comeback!",
    "You think winning makes you the king? Style makes the king. I'M the king.",
    "Every loss is just setup for a more spectacular victory.",
    "The people don't cheer for the winner. They cheer for the SHOW.",
  ],
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const AI_PERSONALITIES: AIPersonality[] = [viktor, rosa, phantom, ace, driftKing];

/** Map model IDs to default personality assignments by difficulty */
export const DIFFICULTY_PERSONALITY_MAP: Record<string, string> = {
  carla_pilotnet: 'ace',       // Easy -> professional, encouraging
  pilotnet: 'rosa',            // Medium -> reckless, fun
  alpamayo: 'viktor',          // Hard -> cold, intimidating
};

/** Get a personality by ID, falling back to a random one */
export function getPersonalityById(id: string): AIPersonality {
  return AI_PERSONALITIES.find(p => p.id === id) ?? AI_PERSONALITIES[Math.floor(Math.random() * AI_PERSONALITIES.length)];
}

/** Select a personality based on model/difficulty, with some randomness for variety */
export function selectPersonality(modelId?: string): AIPersonality {
  const preferredId = modelId ? DIFFICULTY_PERSONALITY_MAP[modelId] : undefined;
  if (preferredId) {
    // 70% chance of the "assigned" personality, 30% chance of a random one for variety
    if (Math.random() < 0.7) {
      return getPersonalityById(preferredId);
    }
  }
  return AI_PERSONALITIES[Math.floor(Math.random() * AI_PERSONALITIES.length)];
}
