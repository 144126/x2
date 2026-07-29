import { describe, it, expect, vi } from 'vitest';
import { CallMesh, type CallSignal, type MeshOpts, DISCONNECT_GRACE_MS } from '../call';

type FakeSender = { track: unknown; replaceTrack: (t: unknown) => Promise<void> };

class FakePC {
	localDescription: unknown = null;
	remoteDescription: unknown = null;
	ice: unknown[] = [];
	senders: FakeSender[] = [];
	closed = false;
	onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
	ontrack: ((e: { streams: unknown[] }) => void) | null = null;
	onconnectionstatechange: (() => void) | null = null;
	connectionState = 'new';
	async createOffer() {
		return { type: 'offer', sdp: 'OFFER' };
	}
	async createAnswer() {
		return { type: 'answer', sdp: 'ANSWER' };
	}
	async setLocalDescription(d: unknown) {
		this.localDescription = d;
	}
	async setRemoteDescription(d: unknown) {
		this.remoteDescription = d;
	}
	async addIceCandidate(c: unknown) {
		this.ice.push(c);
	}
	addTrack(t: unknown) {
		const sender: FakeSender = {
			track: t,
			replaceTrack: async (nt: unknown) => {
				sender.track = nt;
			}
		};
		this.senders.push(sender);
		return sender;
	}
	getSenders() {
		return this.senders;
	}
	close() {
		this.closed = true;
	}
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
		makePC: () => {
			const pc = new FakePC();
			pcs.push(pc);
			return pc as unknown as RTCPeerConnection;
		},
		getMedia: async () => {
			const { stream, tracks } = fakeStream();
			made.push(tracks);
			return stream;
		},
		...opts
	});
	return { mesh, sent, remotes, pcs, made };
}

describe('CallMesh glare avoidance', () => {
	it('offers to a joiner whose uid sorts above mine', async () => {
		const { mesh, sent } = harness('alice');
		await mesh.open(false);
		await mesh.handle('bob', { type: 'join' });
		expect(sent).toEqual([
			{ to: 'bob', signal: { type: 'offer', sdp: { type: 'offer', sdp: 'OFFER' } } }
		]);
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

describe('CallMesh simultaneous join', () => {
	it('does not send a second offer when join and here cross in flight for the same peer', async () => {
		const { mesh, sent, pcs } = harness('alice');
		await mesh.open(false);
		await mesh.handle('bob', { type: 'join' }); // alice < bob -> alice offers, pc created
		await mesh.handle('bob', { type: 'here' }); // same peer replies here before seeing the offer

		expect(sent.filter((s) => s.signal.type === 'offer')).toHaveLength(1);
		expect(pcs).toHaveLength(1);
	});

	it('sends only one offer across two joins from the same peer once a connection exists', async () => {
		const { mesh, sent, pcs } = harness('alice');
		await mesh.open(false);
		await mesh.handle('bob', { type: 'join' }); // alice < bob -> offers, pc created
		await mesh.handle('bob', { type: 'join' }); // a duplicate/retried join from the same peer

		expect(sent.filter((s) => s.signal.type === 'offer')).toHaveLength(1);
		expect(pcs).toHaveLength(1);
	});
});

describe('CallMesh announce', () => {
	it('sends join to every member except myself', async () => {
		const { mesh, sent } = harness('alice');
		await mesh.open(false);
		mesh.announce(['alice', 'bob', 'carol']);
		expect(sent.map((s) => s.to).sort()).toEqual(['bob', 'carol']);
		expect(sent.every((s) => s.signal.type === 'join')).toBe(true);
	});
});

describe('CallMesh ICE forwarding', () => {
	it('forwards local ICE candidates to the right peer', async () => {
		const { mesh, sent, pcs } = harness('alice');
		await mesh.open(false);
		await mesh.handle('bob', { type: 'join' });
		sent.length = 0;

		pcs[0].onicecandidate?.({ candidate: { toJSON: () => ({ candidate: 'c1' }) } });

		expect(sent).toEqual([{ to: 'bob', signal: { type: 'ice', candidate: { candidate: 'c1' } } }]);
	});

	it('applies an incoming ICE signal to the matching connection', async () => {
		const { mesh, pcs } = harness('alice');
		await mesh.open(false);
		await mesh.handle('bob', { type: 'join' });

		await mesh.handle('bob', { type: 'ice', candidate: { candidate: 'remote' } });

		expect(pcs[0].ice).toEqual([{ candidate: 'remote' }]);
	});
});

describe('CallMesh video renegotiation', () => {
	it('adds a video sender and re-offers when video turns on mid-call (audio-only start)', async () => {
		let media_calls: MediaStreamConstraints[] = [];
		const { mesh, sent, pcs } = harness('alice', {
			getMedia: async (c) => {
				media_calls.push(c);
				if (c.video && !c.audio) {
					const vtrack = track('video');
					return {
						getTracks: () => [vtrack],
						getVideoTracks: () => [vtrack],
						getAudioTracks: () => []
					} as unknown as MediaStream;
				}
				const { stream } = fakeStream(); // audio-only, for open()
				return stream;
			}
		});
		await mesh.open(false); // audio-only call
		await mesh.handle('bob', { type: 'join' }); // pc created with one audio sender
		sent.length = 0;

		await mesh.setVideo(true);

		expect(media_calls).toContainEqual({ video: true });
		// a fresh video sender was added (not replaceTrack'd onto the audio sender)
		expect(pcs[0].senders.some((s) => (s.track as FakeTrack).kind === 'video')).toBe(true);
		// turning video on renegotiates — a new offer goes out on the existing connection
		expect(sent.some((s) => s.to === 'bob' && s.signal.type === 'offer')).toBe(true);
	});

	it('replaces an existing sender in place without re-offering when the track kind already has a sender', async () => {
		const { mesh, sent, pcs } = harness('alice');
		await mesh.open(false);
		await mesh.handle('bob', { type: 'join' });
		sent.length = 0;

		const audioSenderBefore = pcs[0].senders[0];
		await mesh.setVideo(false); // no video tracks locally — no senders added, no renegotiation
		expect(sent.filter((s) => s.signal.type === 'offer')).toHaveLength(0);
		expect(pcs[0].senders[0]).toBe(audioSenderBefore);
	});
});

describe('CallMesh connection-state recovery', () => {
	it('drops the peer after the grace period if a disconnected state does not recover', async () => {
		vi.useFakeTimers();
		try {
			const { mesh, pcs, remotes } = harness('alice');
			await mesh.open(false);
			await mesh.handle('bob', { type: 'join' });

			pcs[0].connectionState = 'disconnected';
			pcs[0].onconnectionstatechange?.();
			expect(mesh.peers).toEqual(['bob']); // not dropped immediately

			vi.advanceTimersByTime(DISCONNECT_GRACE_MS);
			expect(mesh.peers).toEqual([]);
			expect(remotes.at(-1)).toEqual({ uid: 'bob', stream: null });
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not drop the peer if the connection recovers before the grace period elapses', async () => {
		vi.useFakeTimers();
		try {
			const { mesh, pcs } = harness('alice');
			await mesh.open(false);
			await mesh.handle('bob', { type: 'join' });

			pcs[0].connectionState = 'disconnected';
			pcs[0].onconnectionstatechange?.();
			pcs[0].connectionState = 'connected'; // recovered before the timer fires

			vi.advanceTimersByTime(DISCONNECT_GRACE_MS);
			expect(mesh.peers).toEqual(['bob']);
		} finally {
			vi.useRealTimers();
		}
	});

	it('drops immediately on failed, without waiting for the grace period', async () => {
		const { mesh, pcs } = harness('alice');
		await mesh.open(false);
		await mesh.handle('bob', { type: 'join' });

		pcs[0].connectionState = 'failed';
		pcs[0].onconnectionstatechange?.();

		expect(mesh.peers).toEqual([]);
	});
});
