import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { createUIMessageStream, createUIMessageStreamResponse, streamText } from 'ai';
import { get_messages, get_group_messages } from '$lib/server/chat';
import { ensure } from '$lib/server/qdrant';
import { deduct, credit } from '$lib/server/credit_client';
import { thread_model, serialize_thread, THREAD_HOLD_KOBO } from '$lib/server/openrouter';
import { thread_cost_kobo } from '$lib/server/pricing';
import { guard } from '$lib/server/rl';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user) throw error(401, 'auth');
	const uid = locals.user.id;
	const b = (await request.json().catch(() => null)) as { conv?: string; question?: string } | null;
	if (!b?.conv || !b?.question?.trim()) throw error(400, 'conv and question required');

	await guard(platform, 'RL_AI', uid);

	const model = await thread_model(env);
	if (!model) throw error(503, 'ai_unavailable');

	await ensure(env);

	let messages;
	if (b.conv.startsWith('g:')) {
		messages = await get_group_messages(env, b.conv.slice(2), uid);
	} else {
		const [a, p] = b.conv.split('|');
		const peer = a === uid ? p : a;
		messages = await get_messages(env, uid, peer);
	}

	const thread = serialize_thread(messages, uid);
	thread.push({ role: 'user', content: b.question });

	const hold = await deduct(locals.x2_ws, uid, THREAD_HOLD_KOBO);
	if (!hold.ok) {
		return new Response(JSON.stringify({ ok: false, reason: 'insufficient_credits' }), {
			status: 402,
			headers: { 'content-type': 'application/json' }
		});
	}

	const result = streamText({
		model,
		system:
			"You are a helpful assistant in a messaging app. Answer the user's question about the conversation thread concisely.",
		messages: thread,
		maxRetries: 0
	});

	const stream = createUIMessageStream({
		execute: async ({ writer }) => {
			writer.write({
				type: 'data-billing',
				data: { balance: hold.balance + THREAD_HOLD_KOBO },
				transient: true
			});
			try {
				const reader = result.toUIMessageStream({ sendReasoning: true }).getReader();
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					writer.write(value);
				}
			} finally {
				// tokens are only known once the stream ends, so the hold is settled here — a
				// stream that died early still settles, because usage resolves either way
				const usage = await result.usage.catch(() => null);
				const cost = usage
					? thread_cost_kobo(usage.inputTokens ?? 0, usage.outputTokens ?? 0)
					: THREAD_HOLD_KOBO;
				let balance = hold.balance;
				if (cost > THREAD_HOLD_KOBO) {
					const r = await deduct(locals.x2_ws, uid, cost - THREAD_HOLD_KOBO);
					balance = Math.max(0, r.balance);
				} else if (cost < THREAD_HOLD_KOBO) {
					balance = (await credit(locals.x2_ws, uid, THREAD_HOLD_KOBO - cost)).balance;
				}
				writer.write({
					type: 'data-billing',
					data: { balance, cost_kobo: cost },
					transient: true
				});
			}
		}
	});

	return createUIMessageStreamResponse({ stream });
};
