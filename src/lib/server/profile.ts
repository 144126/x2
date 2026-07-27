import type { User } from '$lib/types';
import { ZV, ensure, upsert, type QEnv } from './qdrant';
import { get_user } from './user';
import { embed as embed_text } from './or';

async function cleanWhatsApp(num: string, country?: string): Promise<string | undefined> {
	const s = num.trim();
	if (!s) return undefined;
	const { Country } = await import('country-state-city');
	const phonecode = country ? Country.getCountryByCode(country)?.phonecode : undefined;
	let cleaned = s;
	if (phonecode && cleaned.startsWith(`+${phonecode}`)) cleaned = cleaned.slice(phonecode.length + 1);
	else if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);
	return cleaned || undefined;
}

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
		whatsapp?: string;
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
		ci: data.city ?? cur.ci,
		w: data.whatsapp !== undefined
			? data.whatsapp
				? await cleanWhatsApp(data.whatsapp, data.country ?? cur.co)
				: undefined
			: cur.w
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
