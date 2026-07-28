import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// minimal WebSocket + fetch doubles so the shared socket module can be driven by hand
class FakeWS {
	static last: FakeWS | null = null;
	static OPEN = 1;
	readyState = 0;
	sent: string[] = [];
	onopen?: () => void;
	onmessage?: (e: { data: string }) => void;
	onclose?: (event: CloseEvent) => void;
	onerror?: () => void;
	constructor(public url: string) {
		FakeWS.last = this;
	}
	send(d: string) {
		this.sent.push(d);
	}
	close() {
		this.readyState = 3;
		this.onclose?.({ code: 1000, reason: '', wasClean: true } as unknown as CloseEvent);
	}
	open() {
		this.readyState = 1;
		this.onopen?.();
	}
}

let ws: typeof import('../ws');

beforeEach(async () => {
	vi.useFakeTimers();
	vi.stubGlobal('WebSocket', FakeWS);
	vi.stubGlobal('window', {});
	vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ ws: 'ws://x/ws' }) }));
	vi.resetModules();
	ws = await import('../ws');
});

afterEach(() => {
	ws._reset();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('shared ws', () => {
	it('queues kept sends until open, and delivers messages to subscribers', async () => {
		const got: unknown[] = [];
		ws.ws_on((m) => got.push(m));
		ws.ws_send({ type: 'watch', peer: 'p' }, true);
		await flush();

		const sock = FakeWS.last!;
		expect(sock.sent).toEqual([]); // not open yet — nothing sent
		sock.open();
		expect(sock.sent).toEqual([JSON.stringify({ type: 'watch', peer: 'p' })]);

		sock.onmessage!({ data: JSON.stringify({ type: 'msg', text: 'hi' }) });
		expect(got).toEqual([{ type: 'msg', text: 'hi' }]);
	});

	it('reconnects after a drop and replays the kept handshake', async () => {
		const got: { type: string }[] = [];
		ws.ws_on((m) => got.push(m as { type: string }));
		ws.ws_send({ type: 'watch', peer: 'p' }, true);
		await flush();
		const first = FakeWS.last!;
		first.open();
		first.close();

		expect(got.at(-1)).toEqual({ type: 'ws_down' }); // subscribers learn the socket died
		await vi.advanceTimersByTimeAsync(600);
		const second = FakeWS.last!;
		expect(second).not.toBe(first);
		second.open();
		expect(second.sent).toEqual([JSON.stringify({ type: 'watch', peer: 'p' })]);
	});

	it('ws_drop stops a subscription from being replayed', async () => {
		ws.ws_on(() => {});
		const watch = { type: 'watch', peer: 'p' };
		ws.ws_send(watch, true);
		await flush();
		FakeWS.last!.open();
		ws.ws_drop(watch);
		FakeWS.last!.close();
		await vi.advanceTimersByTimeAsync(600);
		FakeWS.last!.open();
		expect(FakeWS.last!.sent).toEqual([]);
	});
});
