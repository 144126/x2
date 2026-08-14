import {
	ZV,
	V,
	ensure,
	upsert,
	retrieve_one,
	search,
	scroll,
	set_payload,
	f,
	f_not,
	eq,
	uuid_from,
	type QEnv
} from './qdrant';
import { available_handle } from './room_handle';
import { embed } from './or';
import { room_join, room_leave, room_is_member } from './hub_client';

export interface Group {
	s: 'g';
	id: string;
	nm: string; // name
	ds: string; // description
	tgs?: string[]; // tags (tokens), folds into the room's embedding like a user's interests
	ow: string; // owner uid
	mb: string[]; // member uids (owner included)
	rs: 'a' | 'p' | 'c'; // room state — a:active p:paused c:closed, default a
	d: number; // created ts
	co?: string; // country
	st?: string; // state / province
	ci?: string; // city
}

export type GroupView = {
	id: string;
	name: string;
	description: string;
	tags?: string[];
	owner: string;
	roomState: 'a' | 'p' | 'c';
	members: string[];
	created: number;
	country?: string;
	state?: string;
	city?: string;
	score?: number;
};

const view = (g: Group, score?: number): GroupView => ({
	id: g.id,
	name: g.nm,
	description: g.ds,
	...(g.tgs?.length ? { tags: g.tgs } : {}),
	owner: g.ow,
	roomState: g.rs ?? 'a',
	members: g.mb ?? [],
	created: g.d,
	...(g.co ? { country: g.co } : {}),
	...(g.st ? { state: g.st } : {}),
	...(g.ci ? { city: g.ci } : {}),
	...(score === undefined ? {} : { score })
});

// name + description + tags are the whole semantic signal for a group, per spec
const group_text = (name: string, description: string, tags?: string[]) =>
	`group_name: ${name}${description.trim() ? ` | group_about: ${description}` : ''}${
		tags?.length ? ` | room_tags: ${tags.join(', ')}` : ''
	}`;

// a room's public id is its handle, which qdrant rejects as a point id (uuid or uint only),
// so every point touch maps it. Rooms made before handles carry a sqids id or a raw uuid —
// both still map through here, so every old room keeps resolving.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const point_id = (id: string): Promise<string> =>
	UUID.test(id) ? Promise.resolve(id) : uuid_from(`g:${id}`);

async function put(env: QEnv, g: Group): Promise<void> {
	const vec = await embed(env, group_text(g.nm, g.ds, g.tgs));
	await upsert(env, [
		{
			id: await point_id(g.id),
			vector: { [V]: vec },
			payload: g as unknown as Record<string, unknown>
		}
	]);
}

async function put_payload(env: QEnv, g: Group): Promise<void> {
	await set_payload(env, await point_id(g.id), g as unknown as Record<string, unknown>);
}

export async function save_group(
	env: QEnv,
	ws: Fetcher,
	ownerId: string,
	data: {
		name: string;
		description?: string;
		tags?: string[];
		room_state?: 'a' | 'p' | 'c';
		country?: string;
		state?: string;
		city?: string;
	}
): Promise<GroupView> {
	await ensure(env);
	const name = data.name.trim();
	if (!name) throw new Error('name_required');
	const g: Group = {
		s: 'g',
		id: await available_handle(name, async (h) => (await raw_group(env, h)) !== null),
		nm: name,
		ds: (data.description ?? '').trim(),
		...(data.tags?.length ? { tgs: data.tags } : {}),
		ow: ownerId,
		mb: [ownerId],
		rs: data.room_state ?? 'a',
		d: Date.now(),
		...(data.country ? { co: data.country } : {}),
		...(data.state ? { st: data.state } : {}),
		...(data.city ? { ci: data.city } : {})
	};
	await put(env, g);
	room_join(env, ws, g.id, ownerId).catch(() => {});
	return view(g);
}

async function raw_group(env: QEnv, id: string): Promise<Group | null> {
	const p = (await retrieve_one(env, await point_id(id)))?.payload as unknown as Group | undefined;
	return p?.s === 'g' ? p : null;
}

export async function get_group(env: QEnv, id: string): Promise<GroupView | null> {
	const g = await raw_group(env, id);
	return g ? view(g) : null;
}

/** owner-only edit. Re-embeds only when name/description actually changed — that's the whole
 *  search text; a location-only edit skips the paid embedding call entirely. */
function apply_location(
	cur: Group,
	updates: { country?: string; state?: string; city?: string }
): Partial<Group> {
	const out: Partial<Group> = {};
	if (updates.country !== undefined) out.co = updates.country || '';
	if (updates.state !== undefined) out.st = updates.state || '';
	if (updates.city !== undefined) out.ci = updates.city || '';
	return out;
}

export async function update_group(
	env: QEnv,
	id: string,
	uid: string,
	updates: {
		name?: string;
		description?: string;
		tags?: string[];
		room_state?: 'a' | 'p' | 'c';
		country?: string;
		state?: string;
		city?: string;
	}
): Promise<GroupView | null> {
	await ensure(env);
	const cur = await raw_group(env, id);
	if (!cur || cur.ow !== uid) return null;
	const next: Group = {
		...cur,
		nm: updates.name?.trim() || cur.nm,
		ds: updates.description === undefined ? cur.ds : updates.description.trim(),
		...(updates.tags !== undefined ? { tgs: updates.tags } : {}),
		...(updates.room_state !== undefined ? { rs: updates.room_state } : {}),
		...apply_location(cur, updates)
	};
	const changed = group_text(next.nm, next.ds, next.tgs) !== group_text(cur.nm, cur.ds, cur.tgs);
	await (changed ? put(env, next) : put_payload(env, next));
	return view(next);
}

export async function delete_group(env: QEnv, id: string, uid: string): Promise<boolean> {
	await ensure(env);
	const cur = await raw_group(env, id);
	if (!cur || cur.ow !== uid) return false;
	const { qc, C } = await import('./qdrant');
	await (await qc(env)).delete(C, { points: [await point_id(id)] }).catch(() => {});
	return true;
}

export async function join_group(
	env: QEnv,
	ws: Fetcher,
	id: string,
	uid: string
): Promise<GroupView | null> {
	await ensure(env);
	const cur = await raw_group(env, id);
	if (!cur) return null;
	const members = await room_join(env, ws, id, uid);
	if (members.length !== cur.mb.length || !members.every((m, i) => m === cur.mb[i])) {
		await set_payload(env, await point_id(id), { mb: members }).catch(() => {});
	}
	return view({ ...cur, mb: members });
}

/** the owner cannot leave — deleting is the way out, so a group always has an owner */
export async function leave_group(
	env: QEnv,
	ws: Fetcher,
	id: string,
	uid: string
): Promise<GroupView | null> {
	await ensure(env);
	const cur = await raw_group(env, id);
	if (!cur || cur.ow === uid) return null;
	const members = await room_leave(env, ws, id, uid);
	await set_payload(env, await point_id(id), { mb: members }).catch(() => {});
	return view({ ...cur, mb: members });
}

/** groups `uid` belongs to (all groups when uid is omitted) */
export async function list_groups(env: QEnv, uid?: string, limit = 50): Promise<GroupView[]> {
	await ensure(env);
	const clauses = uid ? [eq('s', 'g'), eq('mb', uid)] : [eq('s', 'g')];
	const pts = await scroll(
		env,
		uid ? f(...clauses) : f_not(clauses, [eq('rs', 'p'), eq('rs', 'c')]),
		limit
	);
	return pts.map((p) => view(p.payload as unknown as Group)).sort((a, b) => b.created - a.created);
}

function loc_filter(loc: { country?: string; state?: string; city?: string }) {
	const clauses = [eq('s', 'g')];
	if (loc.country) clauses.push(eq('co', loc.country));
	if (loc.state) clauses.push(eq('st', loc.state));
	if (loc.city) clauses.push(eq('ci', loc.city));
	return f_not(clauses, [eq('rs', 'p'), eq('rs', 'c')]);
}

export async function search_groups(
	env: QEnv,
	q: string,
	loc?: { country?: string; state?: string; city?: string },
	limit = 20
): Promise<GroupView[]> {
	await ensure(env);
	const has_loc = loc && (loc.country || loc.state || loc.city);
	const filter = has_loc ? loc_filter(loc!) : f_not([eq('s', 'g')], [eq('rs', 'p'), eq('rs', 'c')]);
	if (!q) {
		const pts = await scroll(env, filter, limit);
		return pts
			.map((p) => view(p.payload as unknown as Group))
			.sort((a, b) => b.created - a.created);
	}
	const vec = await embed(env, q);
	if (vec === ZV) {
		const pts = await scroll(env, filter, limit);
		return pts
			.map((p) => view(p.payload as unknown as Group))
			.sort((a, b) => b.created - a.created);
	}
	const hits = await search(env, vec, filter, limit);
	return hits.map((h) => view(h.payload as unknown as Group, h.score));
}

export async function is_member(env: QEnv, ws: Fetcher, id: string, uid: string): Promise<boolean> {
	return room_is_member(env, ws, id, uid);
}

/** groups both `a` and `b` belong to */
export async function shared_groups(env: QEnv, a: string, b: string): Promise<GroupView[]> {
	const [a_groups, b_groups] = await Promise.all([list_groups(env, a), list_groups(env, b)]);
	const b_ids = new Set(b_groups.map((g) => g.id));
	return a_groups.filter((g) => b_ids.has(g.id));
}
