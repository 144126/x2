import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { createUIMessageStream, createUIMessageStreamResponse, streamText } from 'ai';
import { get_messages, get_group_messages } from '$lib/server/chat';
import { ensure } from '$lib/server/qdrant';
import { deduct, credit } from '$lib/server/credit_client';
import {
	modal_model,
	serialize_thread,
	modal_cost_kobo,
	MODAL_KOBO_PER_SEC,
	MODAL_START_HOLD_KOBO,
	MODAL_MAX_SECONDS
} from '$lib/server/modal';
import { guard } from '$lib/server/rl';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user) throw error(401, 'auth');
	const uid = locals.user.id;
	const b = (await request.json().catch(() => null)) as { conv?: string; question?: string } | null;
	if (!b?.conv || !b?.question?.trim()) throw error(400, 'conv and question required');

	await guard(platform, 'RL_AI', uid);

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

	const holdResult = await deduct(locals.x2_ws, uid, MODAL_START_HOLD_KOBO);
	if (!holdResult.ok) {
		return new Response(JSON.stringify({ ok: false, reason: 'insufficient_credits' }), {
			status: 402,
			headers: { 'content-type': 'application/json' }
		});
	}

	const budget_kobo = holdResult.balance + MODAL_START_HOLD_KOBO;
	const max_seconds = Math.min(MODAL_MAX_SECONDS, Math.floor(budget_kobo / MODAL_KOBO_PER_SEC));

	const controller = new AbortController();
	let truncated = false;
	const timer = setTimeout(() => {
		truncated = true;
		controller.abort();
	}, max_seconds * 1000);
	const start = Date.now();

	const result = streamText({
		model: await modal_model(env as never),
		system:
			"You are a helpful assistant in a messaging app. Answer the user's question about the conversation thread concisely.",
		messages: thread,
		abortSignal: controller.signal,
		maxRetries: 0
	});

	const stream = createUIMessageStream({
		execute: async ({ writer }) => {
			writer.write({
				type: 'data-billing',
				data: { balance: budget_kobo, max_seconds, kobo_per_sec: MODAL_KOBO_PER_SEC },
				transient: true
			});
			try {
				const uiStream = result.toUIMessageStream({ sendReasoning: true });
				const reader = uiStream.getReader();
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					writer.write(value);
				}
			} finally {
				clearTimeout(timer);
				const cost = modal_cost_kobo((Date.now() - start) / 1000);
				let final_balance = holdResult.balance;
				if (cost > MODAL_START_HOLD_KOBO) {
					const extra = cost - MODAL_START_HOLD_KOBO;
					const r = await deduct(locals.x2_ws, uid, extra);
					final_balance = r.ok ? r.balance : Math.max(0, r.balance);
				} else if (cost < MODAL_START_HOLD_KOBO) {
					const r = await credit(locals.x2_ws, uid, MODAL_START_HOLD_KOBO - cost);
					final_balance = r.balance;
				}
				writer.write({
					type: 'data-billing',
					data: { balance: final_balance, cost_kobo: cost, truncated },
					transient: true
				});
			}
		}
	});

	return createUIMessageStreamResponse({ stream });
};
