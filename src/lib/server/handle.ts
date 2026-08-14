/**
 * A readable handle for someone who never signed up.
 *
 * A device account's "email" is a uuid, and the normaliser turns that into
 * `3dfcae71_f891_4e65_a` — which is what the other person sees on every random match.
 * A name you can say out loud is worth more here than anywhere else in the app: it is
 * the first thing you know about a stranger before they speak.
 */

const SHAPE = [
	'amber',
	'bright',
	'calm',
	'copper',
	'dusk',
	'early',
	'even',
	'fair',
	'glad',
	'green',
	'high',
	'kind',
	'late',
	'mild',
	'north',
	'open',
	'plain',
	'quick',
	'quiet',
	'rare',
	'red',
	'sharp',
	'slow',
	'soft',
	'still',
	'sunny',
	'swift',
	'tall',
	'warm',
	'wide',
	'wild',
	'young'
];

const THING = [
	'ash',
	'bay',
	'bell',
	'birch',
	'brook',
	'cedar',
	'cloud',
	'coast',
	'cove',
	'crane',
	'dawn',
	'delta',
	'dune',
	'ember',
	'fern',
	'field',
	'finch',
	'fjord',
	'grove',
	'harbor',
	'heath',
	'hollow',
	'lark',
	'meadow',
	'moss',
	'otter',
	'pine',
	'reed',
	'ridge',
	'river',
	'sparrow',
	'stone',
	'thicket',
	'tide',
	'vale',
	'wren'
];

/** deterministic from the seed, so the same device keeps the same handle */
export async function friendly_handle(seed: string): Promise<string> {
	const h = new Uint8Array(
		await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`handle:${seed}`))
	);
	const shape = SHAPE[((h[0] << 8) | h[1]) % SHAPE.length];
	const thing = THING[((h[2] << 8) | h[3]) % THING.length];
	const n = ((h[4] << 8) | h[5]) % 100;
	return `${shape}_${thing}_${n}`;
}
