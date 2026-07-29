// One shared socket per tab, with reconnect. Every page subscribes through here instead
// of opening its own connection in onMount (which died silently on the first drop and
// left the UI stale until a manual reload).
type Msg = Record<string, unknown> & { type: string };

const subs = new Set<(m: Msg) => void>();
const handshake: string[] = [];
let sock: WebSocket | null = null;
let tries = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let intentionallyClosed = false;
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
let lastMessage = 0;

function report_active(): void {
	if (typeof document === 'undefined') return;
	const on = document.visibilityState === 'visible';
	ws_drop({ type: 'active', on: !on });
	ws_send({ type: 'active', on }, true);
}

function report_active_handshake_only(): void {
	if (typeof document === 'undefined') return;
	const on = document.visibilityState === 'visible';
	ws_drop({ type: 'active', on: !on });
	const data = JSON.stringify({ type: 'active', on });
	if (!handshake.includes(data)) handshake.push(data);
}

if (typeof document !== 'undefined') {
	document.addEventListener('visibilitychange', report_active);
}

async function open() {
	console.log('[WS-CLIENT] open() called', { sock: !!sock, intentionallyClosed, tries });
	if (sock || intentionallyClosed || typeof window === 'undefined') {
		console.log('[WS-CLIENT] open() bailing early', { sock: !!sock, intentionallyClosed, isWindow: typeof window !== 'undefined' });
		return;
	}
	console.log('[WS-CLIENT] fetching /api/wstoken…');
	const r = await fetch('/api/wstoken');
	console.log('[WS-CLIENT] /api/wstoken responded', { status: r.status, ok: r.ok });
	if (!r.ok) {
		console.error('[WS-CLIENT] /api/wstoken FAILED, will retry', { status: r.status, body: await r.text().catch(() => '<unreadable>') });
		return retry();
	}
	const { ws } = (await r.json()) as { ws: string };
	console.log('[WS-CLIENT] opening WebSocket to', ws);
	const s = new WebSocket(ws);
	sock = s;
	s.onopen = () => {
		console.log('[WS-CLIENT] socket OPEN', { url: ws, handshakeQueued: handshake.length });
		lastMessage = Date.now();
		tries = 0;
		report_active_handshake_only();
		for (const m of handshake) {
			console.log('[WS-CLIENT] sending queued handshake msg', m);
			s.send(m);
		}
		clearTimeout(heartbeatTimer!);
		heartbeatTimer = setTimeout(function tick() {
			if (sock?.readyState === WebSocket.OPEN) {
				console.log('[WS-CLIENT] sending heartbeat ping');
				sock.send(JSON.stringify({ type: 'ping' }));
			}
			if (Date.now() - lastMessage > 60_000) {
				console.warn('[WS-CLIENT] no message in 60s, closing socket to force reconnect');
				sock?.close();
				return;
			}
			heartbeatTimer = setTimeout(tick, 30_000);
		}, 30_000);
	};
	s.onmessage = (ev) => {
		lastMessage = Date.now();
		console.log('[WS-CLIENT] message received', ev.data);
		let m: Msg;
		try {
			m = JSON.parse(ev.data);
		} catch (e) {
			console.error('[WS-CLIENT] failed to parse incoming message', ev.data, e);
			return;
		}
		console.log('[WS-CLIENT] dispatching to', subs.size, 'subscribers, type=', m.type);
		for (const fn of subs) fn(m);
	};
	s.onclose = (ev) => {
		console.warn('[WS-CLIENT] socket CLOSED', { code: ev.code, reason: ev.reason, wasClean: ev.wasClean });
		clearTimeout(heartbeatTimer!);
		heartbeatTimer = null;
		if (sock === s) sock = null;
		for (const fn of subs) fn({ type: 'ws_down' });
		retry();
	};
	s.onerror = (ev) => {
		console.error('[WS-CLIENT] socket ERROR', ev);
		s.close();
	};
}

function retry() {
	if (intentionallyClosed || timer || !subs.size) return;
	const delay = Math.min(30_000, 500 * 2 ** tries++);
	console.log('[WS-CLIENT] scheduling reconnect in', delay, 'ms (attempt', tries, ')');
	timer = setTimeout(() => {
		timer = null;
		open();
	}, delay);
}

/** Subscribe to every inbound message. Returns an unsubscribe. */
export function ws_on(fn: (m: Msg) => void): () => void {
	subs.add(fn);
	intentionallyClosed = false;
	open();
	return () => {
		subs.delete(fn);
		if (subs.size) return;
		intentionallyClosed = true;
		if (timer) clearTimeout(timer);
		timer = null;
		sock?.close();
	};
}

/**
 * Send an object. If the socket isn't open yet it's dropped, unless `keep` is set — kept
 * messages are (re)sent on every connect, which is what subscriptions need.
 */
export function ws_send(o: Record<string, unknown>, keep = false): void {
	const data = JSON.stringify(o);
	if (keep && !handshake.includes(data)) handshake.push(data);
	if (sock?.readyState === WebSocket.OPEN) {
		console.log('[WS-CLIENT] ws_send → socket open, sending now', o);
		sock.send(data);
	} else {
		console.warn('[WS-CLIENT] ws_send → socket NOT open (readyState=', sock?.readyState, '), triggering open()', o);
		open();
	}
}

/** Stop keeping `o` alive across reconnects (pair with a `keep` send). */
export function ws_drop(o: Record<string, unknown>): void {
	const i = handshake.indexOf(JSON.stringify(o));
	if (i >= 0) handshake.splice(i, 1);
}

// test hook — resets module state between cases
export function _reset(): void {
	intentionallyClosed = true;
	if (timer) clearTimeout(timer);
	timer = null;
	if (heartbeatTimer) clearTimeout(heartbeatTimer);
	heartbeatTimer = null;
	sock?.close();
	sock = null;
	subs.clear();
	handshake.length = 0;
	tries = 0;
}
