import {
	ZV,
	V,
	ensure,
	upsert,
	retrieve_one,
	new_id,
	search,
	scroll,
	set_payload,
	f,
	eq,
	type QEnv
} from './qdrant';
import { embed } from './or';

export interface Group {
	s: 'g';
	id: string;
	nm: string; // name
	ds: string; // description
	ow: string; // owner uid
	mb: string[]; // member uids (owner included)
	d: number; // created ts
	co?: string; // country
	st?: string; // state / province
	ci?: string; // city
}

export type GroupView = {
	id: string;
	name: string;
	description: string;
	owner: string;
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
	owner: g.ow,
	members: g.mb ?? [],
	created: g.d,
	...(g.co ? { country: g.co } : {}),
	...(g.st ? { state: g.st } : {}),
	...(g.ci ? { city: g.ci } : {}),
	...(score === undefined ? {} : { score })
});

// name + description are the whole semantic signal for a group, per spec
const group_text = (name: string, description: string) =>
	`group_name: ${name}${description.trim() ? ` | group_about: ${description}` : ''}`;

async function put(env: QEnv, g: Group): Promise<void> {
	const vec = await embed(env, group_text(g.nm, g.ds));
	await upsert(env, [
		{ id: g.id, vector: { [V]: vec }, payload: g as unknown as Record<string, unknown> }
	]);
}

async function put_payload(env: QEnv, g: Group): Promise<void> {
	await set_payload(env, g.id, g as unknown as Record<string, unknown>);
}

export async function save_group(
	env: QEnv,
	ownerId: string,
	data: { name: string; description?: string; country?: string; state?: string; city?: string }
): Promise<GroupView> {
	await ensure(env);
	const name = data.name.trim();
	if (!name) throw new Error('name_required');
	const g: Group = {
		s: 'g',
		id: new_id(),
		nm: name,
		ds: (data.description ?? '').trim(),
		ow: ownerId,
		mb: [ownerId],
		d: Date.now(),
		...(data.country ? { co: data.country } : {}),
		...(data.state ? { st: data.state } : {}),
		...(data.city ? { ci: data.city } : {})
	};
	await put(env, g);
	return view(g);
}

async function raw_group(env: QEnv, id: string): Promise<Group | null> {
	const p = (await retrieve_one(env, id))?.payload as unknown as Group | undefined;
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
	updates: { name?: string; description?: string; country?: string; state?: string; city?: string }
): Promise<GroupView | null> {
	await ensure(env);
	const cur = await raw_group(env, id);
	if (!cur || cur.ow !== uid) return null;
	const next: Group = {
		...cur,
		nm: updates.name?.trim() || cur.nm,
		ds: updates.description === undefined ? cur.ds : updates.description.trim(),
		...apply_location(cur, updates)
	};
	const changed = group_text(next.nm, next.ds) !== group_text(cur.nm, cur.ds);
	await (changed ? put(env, next) : put_payload(env, next));
	return view(next);
}

export async function delete_group(env: QEnv, id: string, uid: string): Promise<boolean> {
	await ensure(env);
	const cur = await raw_group(env, id);
	if (!cur || cur.ow !== uid) return false;
	const { qc, C } = await import('./qdrant');
	await (await qc(env)).delete(C, { points: [id] }).catch(() => {});
	return true;
}

export async function join_group(env: QEnv, id: string, uid: string): Promise<GroupView | null> {
	await ensure(env);
	const cur = await raw_group(env, id);
	if (!cur) return null;
	if (cur.mb.includes(uid)) return view(cur);
	const next: Group = { ...cur, mb: [...cur.mb, uid] };
	await put_payload(env, next);
	return view(next);
}

/** the owner cannot leave — deleting is the way out, so a group always has an owner */
export async function leave_group(env: QEnv, id: string, uid: string): Promise<GroupView | null> {
	await ensure(env);
	const cur = await raw_group(env, id);
	if (!cur || cur.ow === uid) return null;
	const next: Group = { ...cur, mb: cur.mb.filter((m) => m !== uid) };
	await put_payload(env, next);
	return view(next);
}

/** groups `uid` belongs to (all groups when uid is omitted) */
export async function list_groups(env: QEnv, uid?: string, limit = 50): Promise<GroupView[]> {
	await ensure(env);
	const pts = await scroll(env, uid ? f(eq('s', 'g'), eq('mb', uid)) : f(eq('s', 'g')), limit);
	return pts.map((p) => view(p.payload as unknown as Group)).sort((a, b) => b.created - a.created);
}

function loc_filter(loc: { country?: string; state?: string; city?: string }) {
	const clauses = [eq('s', 'g')];
	if (loc.country) clauses.push(eq('co', loc.country));
	if (loc.state) clauses.push(eq('st', loc.state));
	if (loc.city) clauses.push(eq('ci', loc.city));
	return f(...clauses);
}

export async function search_groups(
	env: QEnv,
	q: string,
	loc?: { country?: string; state?: string; city?: string },
	limit = 20
): Promise<GroupView[]> {
	await ensure(env);
	const has_loc = loc && (loc.country || loc.state || loc.city);
	const filter = has_loc ? loc_filter(loc!) : f(eq('s', 'g'));
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

export const is_member = (g: GroupView, uid: string): boolean => g.members.includes(uid);

/** groups both `a` and `b` belong to */
export async function shared_groups(env: QEnv, a: string, b: string): Promise<GroupView[]> {
	const [a_groups, b_groups] = await Promise.all([list_groups(env, a), list_groups(env, b)]);
	const b_ids = new Set(b_groups.map((g) => g.id));
	return a_groups.filter((g) => b_ids.has(g.id));
}
