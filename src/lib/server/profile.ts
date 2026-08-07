import type { User } from '../types';
import { V, ensure, upsert, type QEnv } from './qdrant';
import { get_user } from './user';
import { embed as embed_text } from './or';
import { normalize_username, validate_username, username_free } from './username';

// save editable profile fields; re-embeds about+interests for search
export async function save_profile(
	env: QEnv,
	uid: string,
	data: {
		username?: string;
		about?: string;
		interests?: string[];
		age?: number;
		gender?: string;
		country?: string;
		state?: string;
		city?: string;
		whatsapp?: string;
		show_interests?: boolean;
	}
): Promise<void> {
	await ensure(env);
	const cur = await get_user(env, uid);
	if (!cur) throw new Error('no_user');

	let username = cur.u;
	if (data.username !== undefined && data.username.trim() && data.username.trim() !== cur.u) {
		const want = validate_username(normalize_username(data.username));
		if (!want) throw new Error('bad_username');
		if (!(await username_free(env, want, uid))) throw new Error('username_taken');
		username = want;
	}

	const merged: User = {
		...cur,
		u: username,
		a: data.about ?? cur.a,
		i: data.interests ?? cur.i,
		ag: data.age ?? cur.ag,
		r: data.gender ?? cur.r,
		co: data.country ?? cur.co,
		st: data.state ?? cur.st,
		ci: data.city ?? cur.ci,
		si: data.show_interests ?? cur.si,
		w:
			data.whatsapp !== undefined
				? data.whatsapp
					? await cleanWhatsApp(data.whatsapp, data.country ?? cur.co)
					: undefined
				: cur.w
	};

	// embed structured profile: about_user + user_interests tokens (only when there's real content)
	const about = merged.a?.trim();
	const interests = (merged.i ?? []).filter((i) => i.trim());
	const text = [
		about ? `about_user: ${about}` : '',
		interests.length ? `user_interests: ${interests.join(', ')}` : ''
	]
		.filter(Boolean)
		.join(' | ');
	const vec = text ? await embed_text(env, text) : null;
	await upsert(env, [
		{
			id: uid,
			vector: vec && vec.some((n) => n !== 0) ? { [V]: vec } : {},
			payload: merged as unknown as Record<string, unknown>
		}
	]);
}

async function cleanWhatsApp(num: string, country?: string): Promise<string | undefined> {
	const s = num.trim();
	if (!s) return undefined;
	const { Country } = await import('country-state-city');
	const phonecode = country ? Country.getCountryByCode(country)?.phonecode : undefined;
	let cleaned = s;
	if (phonecode && cleaned.startsWith(`+${phonecode}`))
		cleaned = cleaned.slice(phonecode.length + 1);
	else if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);
	return cleaned || undefined;
}
