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

function fakeDoc(visible: boolean) {
	const listeners = new Map<string, () => void>();
	return {
		visibilityState: visible ? 'visible' : 'hidden',
		addEventListener: vi.fn((e: string, fn: () => void) => listeners.set(e, fn)),
		removeEventListener: vi.fn((e: string) => listeners.delete(e)),
		_listeners: listeners
	};
}

beforeEach(async () => {
	vi.useFakeTimers();
	vi.stubGlobal('WebSocket', FakeWS);
	vi.stubGlobal('window', {});
	vi.stubGlobal('document', fakeDoc(true));
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
		expect(sock.sent).toContain(JSON.stringify({ type: 'watch', peer: 'p' }));

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
		expect(second.sent).toContain(JSON.stringify({ type: 'watch', peer: 'p' }));
	});

	it('sends active:true once the socket opens in a visible document', async () => {
		ws.ws_on(() => {});
		await flush();
		FakeWS.last!.open();
		expect(FakeWS.last!.sent).toContain(JSON.stringify({ type: 'active', on: true }));
	});

	it('sends active:false when the document is hidden', async () => {
		ws.ws_on(() => {});
		await flush();
		FakeWS.last!.open();
		const doc = (globalThis as unknown as { document: ReturnType<typeof fakeDoc> }).document;
		doc.visibilityState = 'hidden';
		doc._listeners.get('visibilitychange')!();
		expect(FakeWS.last!.sent).toContain(JSON.stringify({ type: 'active', on: false }));
	});

	it('re-sends the current state on reconnect', async () => {
		ws.ws_on(() => {});
		await flush();
		FakeWS.last!.open();
		FakeWS.last!.close();
		await vi.advanceTimersByTimeAsync(600);
		FakeWS.last!.open();
		const activeMsgs = FakeWS.last!.sent.filter((s) => s.includes('active'));
		expect(activeMsgs.length).toBeGreaterThanOrEqual(1);
		expect(activeMsgs[activeMsgs.length - 1]).toBe(JSON.stringify({ type: 'active', on: true }));
	});

	it('does not accumulate both active:true and active:false in the handshake queue', async () => {
		ws.ws_on(() => {});
		await flush();
		FakeWS.last!.open();
		const doc = (globalThis as unknown as { document: ReturnType<typeof fakeDoc> }).document;
		doc.visibilityState = 'hidden';
		doc._listeners.get('visibilitychange')!();
		doc.visibilityState = 'visible';
		doc._listeners.get('visibilitychange')!();
		doc.visibilityState = 'hidden';
		doc._listeners.get('visibilitychange')!();
		FakeWS.last!.close();
		await vi.advanceTimersByTimeAsync(600);
		FakeWS.last!.open();
		const activeMsgs = FakeWS.last!.sent.filter((s) => s.startsWith('{"type":"active"'));
		expect(activeMsgs.length).toBe(1);
		expect(activeMsgs[0]).toBe(JSON.stringify({ type: 'active', on: false }));
	});
});
