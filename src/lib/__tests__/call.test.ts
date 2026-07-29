import { describe, it, expect, vi } from 'vitest';
import { CallMesh, type CallSignal, type MeshOpts } from '../call';

class FakePC {
	localDescription: unknown = null;
	remoteDescription: unknown = null;
	ice: unknown[] = [];
	senders: { track: unknown }[] = [];
	closed = false;
	onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
	ontrack: ((e: { streams: unknown[] }) => void) | null = null;
	onconnectionstatechange: (() => void) | null = null;
	connectionState = 'new';
	async createOffer() { return { type: 'offer', sdp: 'OFFER' }; }
	async createAnswer() { return { type: 'answer', sdp: 'ANSWER' }; }
	async setLocalDescription(d: unknown) { this.localDescription = d; }
	async setRemoteDescription(d: unknown) { this.remoteDescription = d; }
	async addIceCandidate(c: unknown) { this.ice.push(c); }
	addTrack(t: unknown) { this.senders.push({ track: t }); return { track: t }; }
	getSenders() { return this.senders; }
	close() { this.closed = true; }
}

type FakeTrack = { kind: string; enabled: boolean; stop: ReturnType<typeof vi.fn> };

const track = (kind: string): FakeTrack => ({ kind, enabled: true, stop: vi.fn() });

/** returns the MediaStream-shaped fake plus its track array, so tests can assert on stop() */
function fakeStream(): { stream: MediaStream; tracks: FakeTrack[] } {
	const tracks: FakeTrack[] = [track('audio')];
	const stream = {
		getTracks: () => tracks,
		getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
		getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
		addTrack: (t: FakeTrack) => tracks.push(t),
		removeTrack: (t: FakeTrack) => tracks.splice(tracks.indexOf(t), 1)
	} as unknown as MediaStream;
	return { stream, tracks };
}

function harness(me: string, opts: Partial<MeshOpts> = {}) {
	const sent: { to: string; signal: CallSignal }[] = [];
	const remotes: { uid: string; stream: MediaStream | null }[] = [];
	const pcs: FakePC[] = [];
	const made: FakeTrack[][] = [];
	const mesh = new CallMesh({
		me,
		send: (to, signal) => sent.push({ to, signal }),
		onremote: (uid, stream) => remotes.push({ uid, stream }),
		makePC: () => { const pc = new FakePC(); pcs.push(pc); return pc as unknown as RTCPeerConnection; },
		getMedia: async () => { const { stream, tracks } = fakeStream(); made.push(tracks); return stream; },
		...opts
	});
	return { mesh, sent, remotes, pcs, made };
}

describe('CallMesh glare avoidance', () => {
	it('offers to a joiner whose uid sorts above mine', async () => {
		const { mesh, sent } = harness('alice');
		await mesh.open(false);
		await mesh.handle('bob', { type: 'join' });
		expect(sent).toEqual([{ to: 'bob', signal: { type: 'offer', sdp: { type: 'offer', sdp: 'OFFER' } } }]);
	});

	it('replies "here" instead of offering when the joiner sorts below me', async () => {
		const { mesh, sent } = harness('zoe');
		await mesh.open(false);
		await mesh.handle('bob', { type: 'join' });
		expect(sent).toEqual([{ to: 'bob', signal: { type: 'here' } }]);
	});

	it('offers on "here" from a peer that sorts above me', async () => {
		const { mesh, sent } = harness('alice');
		await mesh.open(false);
		await mesh.handle('bob', { type: 'here' });
		expect(sent[0].signal.type).toBe('offer');
	});

	it('ignores a join while not in a call', async () => {
		const { mesh, sent } = harness('alice');
		await mesh.handle('bob', { type: 'join' });
		expect(sent).toEqual([]);
	});
});

describe('CallMesh teardown', () => {
	it('closes the peer connection on bye and reports the peer gone, without echoing bye', async () => {
		const { mesh, sent, remotes, pcs } = harness('alice');
		await mesh.open(false);
		await mesh.handle('bob', { type: 'join' });
		sent.length = 0;

		await mesh.handle('bob', { type: 'bye' });

		expect(pcs[0].closed).toBe(true);
		expect(remotes.at(-1)).toEqual({ uid: 'bob', stream: null });
		expect(sent).toEqual([]);
		expect(mesh.peers).toEqual([]);
	});

	it('sends bye to every peer and stops local tracks on hangup', async () => {
		const { mesh, sent, made } = harness('alice');
		await mesh.open(false);
		await mesh.handle('bob', { type: 'join' });
		await mesh.handle('carol', { type: 'join' });
		sent.length = 0;

		mesh.hangup();

		expect(sent.map((s) => s.to).sort()).toEqual(['bob', 'carol']);
		expect(sent.every((s) => s.signal.type === 'bye')).toBe(true);
		expect(made[0][0].stop).toHaveBeenCalled();
		expect(mesh.active).toBe(false);
	});

	it('sends no bye when hanging up silently (socket already down)', async () => {
		const { mesh, sent } = harness('alice');
		await mesh.open(false);
		await mesh.handle('bob', { type: 'join' });
		sent.length = 0;
		mesh.hangup(true);
		expect(sent).toEqual([]);
	});
});

describe('CallMesh 1:1 ring flow', () => {
	it('invite() offers regardless of uid ordering', async () => {
		const { mesh, sent } = harness('zoe');
		await mesh.open(false);
		await mesh.invite('bob');
		expect(sent[0]).toMatchObject({ to: 'bob', signal: { type: 'offer' } });
	});

	it('rings instead of auto-answering when onincoming is supplied', async () => {
		const incoming: string[] = [];
		const { mesh, sent } = harness('alice', { onincoming: (uid: string) => incoming.push(uid) });
		await mesh.handle('bob', { type: 'offer', sdp: { type: 'offer', sdp: 'REMOTE' } });

		expect(incoming).toEqual(['bob']);
		expect(sent).toEqual([]);

		await mesh.open(false);
		await mesh.accept('bob');
		expect(sent[0]).toMatchObject({ to: 'bob', signal: { type: 'answer' } });
	});
});
