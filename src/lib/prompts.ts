/**
 * The third participant in a random call.
 *
 * Two strangers left alone default to small talk, which is the version of the
 * conversation they will enjoy least — people reliably expect depth to be more awkward
 * than it turns out to be, and pick shallow anyway. A shared question on both screens
 * removes the "who talks first" freeze and does the escalating that neither stranger
 * will do unprompted.
 *
 * Both people MUST see the same question, so the pick is derived from the conversation
 * id rather than chosen by either client.
 */

/** easy to answer, but never small talk — every one of these produces a story */
const OPEN = [
	'what made you laugh out loud most recently?',
	"what's something you're weirdly good at?",
	'what did you do today that you would do again tomorrow?',
	'what were you into at fourteen that you would still defend?',
	"what's the best thing you've eaten this week?",
	'what would you be doing right now if you were not doing this?',
	"what's a small thing that reliably fixes your mood?"
];

/** the middle of the ladder: opinions and turning points */
const DEEPER = [
	'what have you changed your mind about recently?',
	"what does everyone around you seem to want that you don't?",
	"what's a risk you're glad you took?",
	'what would you do with a completely free year?',
	'what do you believe that most people you know do not?',
	'what is something you are quietly proud of?',
	'what would you want more of, if it cost nothing?'
];

/** Aron's move: make the conversation about the two of you, not the topics */
const MUTUAL = [
	"what's your first impression of me so far?",
	"what do you think we have in common that isn't obvious?",
	'what would you want to be asked that nobody asks you?',
	'if we talk again next week, what should i ask you about?',
	'what do you think i would be surprised to learn about you?'
];

const LADDER = [OPEN, DEEPER, MUTUAL];

function seed_of(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

/**
 * The three questions for this conversation, in escalating order. Deterministic, so both
 * clients render the same thing with no round trip.
 */
export function questions_for(conv: string): string[] {
	const seed = seed_of(conv);
	return LADDER.map((tier, i) => tier[(seed >>> (i * 5)) % tier.length]);
}

/** how long a stranger call runs before it offers a graceful way out, in ms */
export const WRAP_AFTER_MS = 7 * 60_000;

/**
 * How long the skip button stays locked at the start of a stranger call.
 *
 * People mispredict how much they will enjoy talking to a stranger, and they mispredict
 * it worst in the first seconds. A one-tap escape lets everyone act on that wrong
 * prediction at once, which is how roulette products end up as a culture of instant
 * rejection where nobody gets past hello. Leaving because of harm stays instant and
 * free — that is the report button, and it is never locked.
 */
export const SKIP_LOCK_MS = 60_000;

/**
 * The question everyone answers today.
 *
 * One shared question is what makes a pool of recordings feel like one room rather than
 * a pile of monologues, and it is why a stranger's note is worth hearing at all.
 */
const DAILY = [
	'what have you changed your mind about recently?',
	"what's something you're weirdly good at?",
	'what would you do with a completely free year?',
	'what made you laugh out loud most recently?',
	"what's a risk you're glad you took?",
	'what do you believe that most people you know do not?',
	'what were you into at fourteen that you would still defend?',
	'what is something you are quietly proud of?',
	"what's the last thing that genuinely surprised you?",
	'what would you want more of, if it cost nothing?',
	'what is a small thing that reliably fixes your mood?',
	'what would you tell someone arriving in your city for a week?',
	"what's something you started and never finished, but still think about?",
	'who taught you something you still use every day?'
];

/** stable id for a day, so a note can be filed under the question it answers */
export function prompt_id(now = Date.now()): string {
	return new Date(now).toISOString().slice(0, 10);
}

export function prompt_of_the_day(now = Date.now()): string {
	const day = Math.floor(now / 86_400_000);
	return DAILY[day % DAILY.length];
}
