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

async function open() {
	if (sock || intentionallyClosed || typeof window === 'undefined') return;
	const r = await fetch('/api/wstoken');
	if (!r.ok) return retry();
	const { ws } = (await r.json()) as { ws: string };
	const s = new WebSocket(ws);
	sock = s;
	s.onopen = () => {
		lastMessage = Date.now();
		tries = 0;
		for (const m of handshake) s.send(m);
		clearTimeout(heartbeatTimer!);
		heartbeatTimer = setTimeout(function tick() {
			if (sock?.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ type: 'ping' }));
			if (Date.now() - lastMessage > 60_000) { sock?.close(); return; }
			heartbeatTimer = setTimeout(tick, 30_000);
		}, 30_000);
	};
	s.onmessage = (ev) => {
		lastMessage = Date.now();
		let m: Msg;
		try {
			m = JSON.parse(ev.data);
		} catch {
			return;
		}
		for (const fn of subs) fn(m);
	};
	s.onclose = () => {
		clearTimeout(heartbeatTimer!);
		heartbeatTimer = null;
		if (sock === s) sock = null;
		for (const fn of subs) fn({ type: 'ws_down' });
		retry();
	};
	s.onerror = () => s.close();
}

function retry() {
	if (intentionallyClosed || timer || !subs.size) return;
	const delay = Math.min(30_000, 500 * 2 ** tries++);
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
	if (sock?.readyState === WebSocket.OPEN) sock.send(data);
	else open();
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
