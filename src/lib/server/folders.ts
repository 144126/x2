import { ensure, upsert, scroll, remove, new_id, f, eq, type QEnv } from './qdrant';

export interface Folder {
	s: 'fo';
	id: string;
	ow: string; // owner uid — short key, matches the indexed field the filters use
	k: 'c' | 'r'; // 'c' = chat folder, 'r' = room folder (indexed: 'k')
	name: string;
	convs: string[]; // peer uids for 'c'; room ids for 'r'
	d: number;
}

export async function save_folder(
	env: QEnv,
	owner: string,
	name: string,
	kind: 'c' | 'r' = 'c'
): Promise<Folder> {
	await ensure(env);
	const fo: Folder = { s: 'fo', id: new_id(), ow: owner, k: kind, name, convs: [], d: Date.now() };
	await upsert(env, [{ id: fo.id, vector: {}, payload: fo as unknown as Record<string, unknown> }]);
	return fo;
}

export async function list_folders(env: QEnv, uid: string, kind?: 'c' | 'r'): Promise<Folder[]> {
	await ensure(env);
	const pts = await scroll(env, f(eq('s', 'fo'), eq('ow', uid)), 200);
	return pts
		.map((p) => p.payload as unknown as Folder)
		.filter((fo) => !kind || (fo.k ?? 'c') === kind)
		.sort((a, b) => a.d - b.d);
}

async function owned_folder(env: QEnv, uid: string, folder_id: string): Promise<Folder | null> {
	const pts = await scroll(env, f(eq('s', 'fo'), eq('ow', uid)), 200);
	const fo = pts.find((p) => p.id === folder_id)?.payload as unknown as Folder | undefined;
	return fo ?? null;
}

async function save(env: QEnv, fo: Folder): Promise<void> {
	await upsert(env, [{ id: fo.id, vector: {}, payload: fo as unknown as Record<string, unknown> }]);
}

export async function assign_conv(
	env: QEnv,
	uid: string,
	folder_id: string,
	conv: string
): Promise<boolean> {
	await ensure(env);
	const fo = await owned_folder(env, uid, folder_id);
	if (!fo) return false;
	if (!fo.convs.includes(conv)) fo.convs = [...fo.convs, conv];
	await save(env, fo);
	return true;
}

export async function unassign_conv(
	env: QEnv,
	uid: string,
	folder_id: string,
	conv: string
): Promise<boolean> {
	await ensure(env);
	const fo = await owned_folder(env, uid, folder_id);
	if (!fo) return false;
	fo.convs = fo.convs.filter((c) => c !== conv);
	await save(env, fo);
	return true;
}

export async function delete_folder(env: QEnv, uid: string, folder_id: string): Promise<boolean> {
	await ensure(env);
	const fo = await owned_folder(env, uid, folder_id);
	if (!fo) return false;
	await remove(env, [folder_id]);
	return true;
}
