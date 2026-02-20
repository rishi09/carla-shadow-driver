/**
 * commentary.ts - Pre-generated race commentary lines
 *
 * A bank of 200+ commentary lines organized by race event type.
 * Lines are written in authentic motorsport commentary style (F1, GT, WRC)
 * with a mix of excited, analytical, and dramatic delivery.
 */

export type CommentaryEventType =
  | 'race_start'
  | 'overtake_player'
  | 'overtake_ai'
  | 'high_speed'
  | 'close_gap'
  | 'big_lead'
  | 'collision'
  | 'drift'
  | 'final_lap'
  | 'photo_finish'
  | 'win'
  | 'loss'
  | 'checkpoint'
  | 'pb'
  | 'nice_save';

/** Priority level for each event type. Higher priority overrides lower. */
export const COMMENTARY_PRIORITY: Record<CommentaryEventType, number> = {
  checkpoint: 1,
  high_speed: 2,
  big_lead: 2,
  close_gap: 3,
  drift: 3,
  collision: 4,
  nice_save: 5,
  overtake_player: 6,
  overtake_ai: 6,
  final_lap: 7,
  photo_finish: 8,
  pb: 8,
  race_start: 9,
  win: 10,
  loss: 10,
};

/** The full commentary bank, indexed by event type. */
export const COMMENTARY_LINES: Record<CommentaryEventType, string[]> = {
  race_start: [
    "And they're off!",
    "Green light, GO GO GO!",
    "The lights go out and away we go!",
    "It's lights out, let's race!",
    "We are GO! The race is on!",
    "Engines screaming, here we go!",
    "The flag drops and the action begins!",
    "And the race is LIVE!",
    "Full power off the line!",
    "The grid erupts! We have a race!",
    "Clutch drops, tires squeal, we're racing!",
    "The tension breaks -- GO!",
    "Both cars launch! Game ON!",
    "They explode off the line!",
  ],

  overtake_player: [
    "WHAT A MOVE! The player takes the lead!",
    "Brilliant overtake on the inside!",
    "A decisive pass, absolutely clinical!",
    "Into the lead! What a maneuver!",
    "PASSED! Clean, brave, brilliant!",
    "The AI had no answer to that move!",
    "Around the outside! Gutsy driving!",
    "That was inch-perfect. Into P1!",
    "A stunning overtake under pressure!",
    "Sent it up the inside, made it stick!",
    "Sublime racecraft on display here!",
    "Threading the needle! Into the lead!",
    "That pass was a thing of beauty!",
    "The player seizes the moment!",
  ],

  overtake_ai: [
    "The AI car fights back!",
    "Oh no, the AI has taken the lead!",
    "The machine strikes back!",
    "Lost the position! The AI is relentless!",
    "The AI pounces on the opportunity!",
    "Overtaken! The AI finds a way through!",
    "Down to P2. Time to respond!",
    "The AI makes its move! Can it hold on?",
    "That's a bold move from the AI!",
    "The algorithm exploits the gap!",
    "Position lost! Now the real race begins!",
    "The AI smells blood and takes the lead!",
    "Outdone by the machine! Need to fight back!",
    "A calculated pass from the AI!",
  ],

  high_speed: [
    "Reaching incredible speeds here!",
    "Absolutely flat out down the straight!",
    "Maximum velocity! The engine is screaming!",
    "Pinned to the seat at these speeds!",
    "Blisteringly quick through this section!",
    "The speedometer is off the charts!",
    "Full beans! What a rush!",
    "Terminal velocity! Hold on tight!",
    "Flying through at warp speed!",
    "That's some serious pace right there!",
    "Eye-watering speed down the straight!",
    "The engine is singing at full chat!",
    "The scenery is just a blur at this speed!",
    "Pedal to the metal! Incredible velocity!",
  ],

  close_gap: [
    "Gap closing rapidly!",
    "They're nose to tail now!",
    "This is getting intense!",
    "Bumper to bumper! Nobody's backing off!",
    "Less than a second between them!",
    "The pressure is immense right now!",
    "So close! One mistake and it's over!",
    "The gap is vanishing! This is electric!",
    "Within striking distance!",
    "Wheel to wheel racing at its finest!",
    "The tension is absolutely palpable!",
    "Door handle to door handle!",
    "Neither driver willing to yield!",
    "Millimeters separate these two!",
    "The gap is nothing! Absolute drama!",
    "Trading paint at these speeds!",
  ],

  big_lead: [
    "Dominant performance so far!",
    "The leader is pulling away!",
    "Building a comfortable advantage!",
    "Clear air and pushing hard!",
    "Nobody can touch this pace!",
    "A masterclass in controlled aggression!",
    "Running away with it!",
    "Stretching the gap every lap!",
    "In a league of their own right now!",
    "A commanding lead taking shape!",
    "Gap is growing. Total dominance!",
    "Setting the pace with authority!",
    "This is a statement drive!",
  ],

  collision: [
    "Contact! That's going to cost them!",
    "Ouch! Big impact there!",
    "BANG! That'll leave a mark!",
    "Wheel to wheel gets too close!",
    "Collision! Sparks fly!",
    "Into the barrier! Can they recover?",
    "That's a hard hit! Check the damage!",
    "CRUNCH! Costly contact there!",
    "Metal meets metal! Not ideal!",
    "Off line and into trouble!",
    "A big shunt! Losing precious time!",
    "Impact! That's going to hurt the gap!",
    "Touring car racing, baby!",
    "That's touring car rules!",
    "A bit of rubbin' is racing!",
    "That's racing! Sometimes you make contact!",
  ],

  drift: [
    "Beautiful drift through that corner!",
    "Sideways and loving it!",
    "Look at that angle! Incredible car control!",
    "Controlled chaos through the bend!",
    "The rear is out! Riding the slide!",
    "Drifting with style and precision!",
    "Smoke and sideways! Pure spectacle!",
    "Textbook opposite lock right there!",
    "The car is dancing through the corner!",
    "Counter-steer perfection!",
    "That drift was absolutely wild!",
    "Playing with the rear end beautifully!",
    "Sliding through like butter! Gorgeous!",
  ],

  final_lap: [
    "FINAL LAP! It all comes down to this!",
    "Last lap, everything on the line!",
    "The white flag is out! One lap to go!",
    "This is it! The final tour!",
    "Last lap! Push or be pushed!",
    "One more lap to decide it all!",
    "The final lap! History in the making!",
    "Into the last lap! Leave nothing on the table!",
    "Bell lap! Now or never!",
    "The last lap looms! Who wants it more?",
    "Final lap! Every corner counts now!",
    "This is the decider! Last lap!",
  ],

  photo_finish: [
    "It's going to be CLOSE!",
    "Photo finish incoming!",
    "This could go either way!",
    "Down to the wire!",
    "Neck and neck to the line!",
    "NOBODY is giving an inch!",
    "A drag race to the flag!",
    "This is going down to the final meters!",
    "Side by side across the line!",
    "The finish line can't come soon enough!",
    "Absolute nail-biter at the flag!",
    "Who's going to blink first?",
  ],

  win: [
    "VICTORY! What a drive!",
    "Incredible performance! The winner!",
    "Across the line! CHAMPION!",
    "Checkered flag! Brilliant racing!",
    "What a race! Well deserved!",
    "Takes the win! Magnificent!",
    "P1! An outstanding display!",
    "You've done it! Victory is yours!",
    "First across the line! Superb!",
    "Race won! What a performance!",
    "A dominant victory! Flawless execution!",
    "The crowd goes wild! Winner!",
    "Man beats machine! What a story!",
  ],

  loss: [
    "So close! The AI takes this one.",
    "Not quite this time, but what a race!",
    "Beaten to the flag. Next time!",
    "Second place today. The machine wins!",
    "Pipped at the post! Agonizing!",
    "The AI holds on for the win!",
    "A valiant effort, but not enough today!",
    "So near and yet so far!",
    "Outpaced at the end! Hard to take!",
    "The AI proves too strong today!",
    "Close but no cigar! Time for revenge!",
    "Defeat, but the pace was there! Keep pushing!",
  ],

  checkpoint: [
    "Clean through that section!",
    "Perfect line through the chicane!",
    "Nailed that sector!",
    "Textbook precision through there!",
    "Good pace through that section!",
    "Solid driving through the complex!",
    "That was a clean run through!",
    "Carrying great speed through there!",
    "Smooth and efficient through that sequence!",
    "Maintaining rhythm through the corners!",
    "A well-judged run through that section!",
    "Clean and fast through the twisty bits!",
    "Right on the apex! Great racing line!",
  ],

  pb: [
    "NEW PERSONAL BEST! That's a record!",
    "They've beaten their own time!",
    "PB smashed! What an improvement!",
    "A new benchmark! Personal best!",
    "Faster than ever before! NEW PB!",
    "Breaking their own record! Incredible!",
    "PERSONAL BEST! The time to beat!",
    "That's the quickest we've ever seen from them!",
    "Obliterated the old PB! Phenomenal!",
    "New personal record! And they make it look easy!",
    "A new standard has been set!",
    "Rewrote the record books! Stunning lap!",
  ],

  nice_save: [
    "WHAT A SAVE! Nearly lost it there!",
    "Incredible car control!",
    "Caught it just in time! Heart in mouth!",
    "Teetering on the edge but pulled it back!",
    "A miraculous recovery! Nerves of steel!",
    "Almost went off, but saved it beautifully!",
    "On the absolute limit and got away with it!",
    "How did they keep that together?!",
    "Skating on thin ice but survived!",
    "Reflexes like a cat! Tremendous save!",
    "That was hairy! But what a recovery!",
    "Right on the ragged edge but held it!",
  ],
};
