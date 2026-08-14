// A room's public id is its handle — the thing after the ~ in /~cooking-club. Hyphens, not
// underscores: search engines read a hyphen as a word break and an underscore as a word
// joiner, so `cooking-club` indexes as two words. Hyphens also survive a link underline,
// which an underscore hides under, and need no shift key on a phone.

const HANDLE = /^[a-z0-9][a-z0-9-]{2,29}$/;
const MAX = 30;

/** a room name → the handle its url is built from. Never throws. */
export function normalize_handle(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	if (slug.length <= MAX) return slug;
	// cut back to a whole word, so a long name never ends mid-syllable
	const cut = slug.slice(0, MAX);
	const at = cut.lastIndexOf('-');
	const word = at > 0 ? cut.slice(0, at) : cut;
	return (word.length >= 3 ? word : cut).replace(/-+$/, '');
}

const digits = (n: number) => Math.floor(Math.random() * 9 * n) + n;

/**
 * The clean handle goes to whoever asks first; everyone after it gets two random digits.
 * Two digits is a hundred slots — short enough that the url stays speakable, and roomy
 * until about fifty rooms want the same name. Random rather than counting up, so nobody
 * can walk the room list by guessing the next number.
 */
export async function available_handle(
	name: string,
	taken: (handle: string) => Promise<boolean>
): Promise<string> {
	const base = normalize_handle(name) || 'room';
	if (HANDLE.test(base) && !(await taken(base))) return base;
	const stem = base.slice(0, MAX - 3).replace(/-+$/, '');
	for (let n = 0; n < 12; n++) {
		const candidate = `${stem}-${digits(10)}`;
		if (!(await taken(candidate))) return candidate;
	}
	// twelve misses on a hundred slots means the name is genuinely crowded, so go wider
	return `${base.slice(0, MAX - 5).replace(/-+$/, '')}-${digits(1000)}`;
}
