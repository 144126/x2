import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { get_messages, get_group_messages, group_conv_id } from '$lib/server/chat';
import { ensure } from '$lib/server/qdrant';
import { deduct, credit, type DeductResult } from '$lib/server/credit_client';
import { record_event } from '$lib/server/credits';
import {
	modal_stream,
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
		messages = await get_group_messages(env, b.conv.slice(2));
	} else {
		const [a, p] = b.conv.split('|');
		const peer = a === uid ? p : a;
		messages = await get_messages(env, uid, peer);
	}

	const thread = serialize_thread(messages, uid);
	thread.push({ role: 'user', content: b.question });

	const holdResult = await deduct(locals.x2_ws, uid, MODAL_START_HOLD_KOBO);
	if (!holdResult.ok) {
		return new Response(
			JSON.stringify({ ok: false, reason: 'insufficient_credits' }),
			{ status: 402, headers: { 'content-type': 'application/json' } }
		);
	}

	const budget_kobo = holdResult.balance + MODAL_START_HOLD_KOBO;
	const max_seconds = Math.min(MODAL_MAX_SECONDS, Math.floor(budget_kobo / MODAL_KOBO_PER_SEC));

	const modalRes = await modal_stream(
		env as never,
		[{ role: 'system', content: 'You are a helpful assistant in a messaging app. Answer the user\'s question about the conversation thread concisely.' }, ...thread]
	);

	if (!modalRes.ok) {
		await credit(locals.x2_ws, uid, MODAL_START_HOLD_KOBO);
		return new Response(
			JSON.stringify({ ok: false, reason: 'modal_unavailable' }),
			{ status: 502, headers: { 'content-type': 'application/json' } }
		);
	}

	const encoder = new TextEncoder();
	const reader = modalRes.body?.getReader();
	if (!reader) {
		await credit(locals.x2_ws, uid, MODAL_START_HOLD_KOBO);
		return new Response(
			JSON.stringify({ ok: false, reason: 'modal_unavailable' }),
			{ status: 502, headers: { 'content-type': 'application/json' } }
		);
	}

	let billable_ms = 0;
	let text = '';
	let truncated = false;
	const start = Date.now();

	const stream = new ReadableStream({
		async pull(controller) {
			controller.enqueue(encoder.encode(
				`event: start\ndata: ${JSON.stringify({ balance: holdResult.balance + MODAL_START_HOLD_KOBO, max_seconds, kobo_per_sec: MODAL_KOBO_PER_SEC })}\n\n`
			));

			let leftover = '';
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					billable_ms = Date.now() - start;
					if (billable_ms / 1000 >= max_seconds) {
						truncated = true;
						break;
					}

					const chunk = new TextDecoder().decode(value);
					leftover += chunk;
					const lines = leftover.split('\n');
					leftover = lines.pop() ?? '';

					for (const line of lines) {
						if (line.startsWith('data: ')) {
							try {
								const data = JSON.parse(line.slice(6));
								const content = (data as { choices: { delta: { content?: string } }[] }).choices?.[0]?.delta?.content;
								if (content) {
									text += content;
									controller.enqueue(encoder.encode(`event: text\ndata: ${JSON.stringify({ text: content })}\n\n`));
								}
							} catch {
							}
						}
					}
				}
			} catch {
			}

			billable_ms = Date.now() - start;
			const cost = modal_cost_kobo(billable_ms / 1000);
			let final_balance = 0;

			if (cost > MODAL_START_HOLD_KOBO) {
				const extra = cost - MODAL_START_HOLD_KOBO;
				const r = await deduct(locals.x2_ws, uid, extra);
				if (r.ok) {
					final_balance = r.balance;
				} else {
					final_balance = Math.max(0, (r as DeductResult & { balance: number }).balance);
				}
			} else if (cost < MODAL_START_HOLD_KOBO) {
				const refund = MODAL_START_HOLD_KOBO - cost;
				const r = await credit(locals.x2_ws, uid, refund);
				final_balance = r.balance;
			} else {
				final_balance = holdResult.balance;
			}

			controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ balance: final_balance, cost_kobo: cost, truncated })}\n\n`));
			controller.close();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			'connection': 'keep-alive'
		}
	});
};
