import type { User } from '$lib/types';
import { ZV, ensure, upsert, type QEnv } from './qdrant';
import { get_user } from './user';
import { embed as embed_text } from './or';

// save editable profile fields; re-embeds about+interests+username for search
export async function save_profile(
	env: QEnv,
	uid: string,
	data: {
		name?: string;
		username?: string;
		about?: string;
		interests?: string[];
		age?: number;
		gender?: string;
		country?: string;
		state?: string;
		city?: string;
	}
): Promise<void> {
	await ensure(env);
	const cur = await get_user(env, uid);
	if (!cur) throw new Error('no_user');
	const merged: User = {
		...cur,
		n: data.name ?? cur.n,
		u: data.username ?? cur.u,
		a: data.about ?? cur.a,
		i: data.interests ?? cur.i,
		ag: data.age ?? cur.ag,
		r: data.gender ?? cur.r,
		co: data.country ?? cur.co,
		st: data.state ?? cur.st,
		ci: data.city ?? cur.ci
	};
	// embed structured profile: about_user + user_interests tokens (only when there's real content)
	const about = merged.a?.trim();
	const interests = (merged.i ?? []).filter((i) => i.trim());
	const parts = [
		about ? `about_user: ${about}` : '',
		interests.length ? `user_interests: ${interests.join(', ')}` : ''
	].filter(Boolean);
	const text = parts.join(' | ');
	const vec = text ? await embed_text(env, text) : ZV;
	await upsert(env, [{ id: uid, vector: vec, payload: merged as unknown as Record<string, unknown> }]);
}
