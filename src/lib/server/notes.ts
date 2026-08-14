import {
	ensure,
	upsert,
	scroll,
	remove,
	retrieve_many,
	uuid_from,
	new_id,
	f,
	f_not,
	eq,
	type QEnv
} from './qdrant';
import { get_user, patch_user } from './user';

/**
 * The voice-note pool: the durable half of x2.
 *
 * Live presence is perishable — it has to be produced at the exact instant it is
 * consumed, which is why every random-chat product dies outside peak hours. A recording
 * is durable. You can stockpile it, so the site is never empty and time-to-first-human
 * is seconds regardless of who is online.
 */

export type Note = {
	s: 'vn';
	id: string;
	f: string; // author uid
	k: string; // r2 media key
	pr: string; // prompt this answers
	x?: string; // transcript, once it lands
	th: number; // conversations this note has started
	d: number;
};

/** an open note stops being offered after a week */
export const NOTE_TTL = 7 * 86_400_000;
/** …unless retiring it would leave the pool this thin. A hard delete on day seven takes
 *  the whole seeded pool out in one instant and the product dies quietly. */
export const POOL_FLOOR = 20;
/** one note can start this many conversations before it retires, having done its job */
export const MAX_THREADS = 5;
/** how many recently-heard notes a listener remembers, so nothing repeats */
const HEARD_MEMORY = 200;

const PAGE = 60;

export async function add_note(env: QEnv, uid: string, key: string, prompt: string): Promise<Note> {
	await ensure(env);
	// one open note per person per prompt: the prompt is the slot, which keeps one
	// prolific voice from becoming most of what everyone hears
	const mine = await scroll(env, f(eq('s', 'vn'), eq('f', uid), eq('pr', prompt)), 10);
	if (mine.length)
		await remove(
			env,
			mine.map((p) => String(p.id))
		);

	const note: Note = {
		s: 'vn',
		id: new_id(),
		f: uid,
		k: key,
		pr: prompt,
		th: 0,
		d: Date.now()
	};
	await upsert(env, [
		{
			id: await uuid_from(`vn:${note.id}`),
			vector: {},
			payload: note as unknown as Record<string, unknown>
		}
	]);
	return note;
}

export async function set_transcript(env: QEnv, note: Note, x: string): Promise<void> {
	await upsert(env, [
		{
			id: await uuid_from(`vn:${note.id}`),
			vector: {},
			payload: { ...note, x } as unknown as Record<string, unknown>
		}
	]);
}

/**
 * The next note this person has not heard, newest first.
 *
 * Expiry is applied here rather than by a sweep, and only while the pool can afford it —
 * see POOL_FLOOR.
 */
export async function next_note(env: QEnv, uid: string): Promise<Note | null> {
	await ensure(env);
	const heard = new Set((await get_user(env, uid))?.hn ?? []);
	const rows = await scroll(env, f_not([eq('s', 'vn')], [eq('f', uid)]), PAGE);
	const all = rows.map((r) => r.payload as unknown as Note).filter(Boolean);

	const now = Date.now();
	const fresh = all.filter((n) => now - n.d < NOTE_TTL && n.th < MAX_THREADS);
	// below the floor, an old note is better than silence
	const playable = (fresh.length >= POOL_FLOOR ? fresh : all.filter((n) => n.th < MAX_THREADS))
		.filter((n) => !heard.has(n.id))
		.sort((a, b) => b.d - a.d);

	return playable[0] ?? null;
}

/** remember that this person heard it, so it is never played to them twice */
export async function mark_heard(env: QEnv, uid: string, note_id: string): Promise<void> {
	const u = await get_user(env, uid);
	if (!u) return;
	const hn = [note_id, ...(u.hn ?? []).filter((x) => x !== note_id)].slice(0, HEARD_MEMORY);
	await patch_user(env, uid, { hn });
}

export async function get_note(env: QEnv, note_id: string): Promise<Note | null> {
	const pts = await retrieve_many(env, [await uuid_from(`vn:${note_id}`)]);
	const p = pts[0]?.payload as unknown as Note | undefined;
	return p?.s === 'vn' ? p : null;
}

/** a reply turns the note into a conversation; enough of those and it retires */
export async function count_thread(env: QEnv, note: Note): Promise<void> {
	await upsert(env, [
		{
			id: await uuid_from(`vn:${note.id}`),
			vector: {},
			payload: { ...note, th: note.th + 1 } as unknown as Record<string, unknown>
		}
	]);
}

export async function delete_note(env: QEnv, uid: string, note_id: string): Promise<boolean> {
	const note = await get_note(env, note_id);
	if (!note || note.f !== uid) return false;
	await remove(env, [await uuid_from(`vn:${note_id}`)]);
	return true;
}

export async function my_notes(env: QEnv, uid: string): Promise<Note[]> {
	await ensure(env);
	const rows = await scroll(env, f(eq('s', 'vn'), eq('f', uid)), 20);
	return rows.map((r) => r.payload as unknown as Note).sort((a, b) => b.d - a.d);
}
