import { error } from '@sveltejs/kit';

type Limiter = { limit(o: { key: string }): Promise<{ success: boolean }> };

export async function guard(
	platform: App.Platform | undefined,
	binding: string,
	key: string
): Promise<void> {
	const rl = (platform?.env as Record<string, unknown> | undefined)?.[binding] as
		| Limiter
		| undefined;
	if (!rl) return;
	const { success } = await rl.limit({ key });
	if (!success) throw error(429, 'slow_down');
}
