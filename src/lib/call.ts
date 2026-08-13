// Shared WebRTC mesh. A 1:1 call is a mesh of one peer, so the DM page and the room page
// run the same connection, teardown and glare logic.
//
// Pairing rule: a joiner broadcasts `join`. A member already in the call either offers
// (when its own uid sorts lower) or answers with `here`, which prompts the lower-sorting
// joiner to offer. Exactly one offer per pair, from the lexicographically-lower uid.
//
// ponytail: full mesh — N*(N-1)/2 connections and N-1 uplinks per participant. Fine to
// ~4-6 people; move to an SFU (Cloudflare Calls) if rooms need to get bigger.

export type CallSignal =
	| { type: 'join' }
	| { type: 'here' }
	| { type: 'offer'; sdp: RTCSessionDescriptionInit }
	| { type: 'answer'; sdp: RTCSessionDescriptionInit }
	| { type: 'ice'; candidate: RTCIceCandidateInit }
	| { type: 'bye' };

export type MeshOpts = {
	me: string;
	send: (to: string, signal: CallSignal) => void;
	onremote: (uid: string, stream: MediaStream | null) => void;
	/** supplied by 1:1 callers that want a ring UI; omitted = auto-answer (rooms) */
	onincoming?: (uid: string, sdp: RTCSessionDescriptionInit) => void;
	makePC?: (config?: RTCConfiguration) => RTCPeerConnection;
	getMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
	fetchTurn?: () => Promise<RTCIceServer[]>;
};

// ponytail: free Google STUN only — add TURN for symmetric NATs in prod
const STUN: RTCIceServer = { urls: 'stun:stun.l.google.com:19302' };

/** how long a 'disconnected' peer connection gets to recover before we treat it as gone */
export const DISCONNECT_GRACE_MS = 10_000;

/** getUserMedia, but with a clear failure when the browser hides it (an insecure origin) */
function default_media(c: MediaStreamConstraints): Promise<MediaStream> {
	if (!navigator.mediaDevices?.getUserMedia)
		return Promise.reject(new Error('media_unavailable'));
	return navigator.mediaDevices.getUserMedia(c);
}

/** turn a getUserMedia failure into copy that names the real cause */
export function media_error(e: unknown): string {
	const name = e instanceof Error ? (e.name === 'Error' ? e.message : e.name) : '';
	switch (name) {
		case 'media_unavailable':
			return 'this browser blocks camera and mic access here — open the site over https.';
		case 'NotAllowedError':
		case 'SecurityError':
			return 'camera/mic permission was denied — allow it in the browser site settings.';
		case 'NotFoundError':
		case 'OverconstrainedError':
			return 'no camera or mic was found on this device.';
		case 'NotReadableError':
			return 'the camera or mic is already in use by another app — close it and try again.';
		default:
			return `could not start the call (${name || 'unknown error'}).`;
	}
}

export class CallMesh {
	private o: MeshOpts;
	private pcs = new Map<string, RTCPeerConnection>();
	private pending = new Map<string, RTCSessionDescriptionInit>();
	private local: MediaStream | null = null;
	private turnServers: RTCIceServer[] = [];
	private turnFetched = false;

	constructor(opts: MeshOpts) {
		this.o = opts;
	}

	private async ensureTurn(): Promise<void> {
		if (this.turnFetched || !this.o.fetchTurn) return;
		this.turnFetched = true;
		try {
			this.turnServers = await this.o.fetchTurn();
		} catch {
			this.turnServers = [];
		}
	}

	get peers(): string[] {
		return [...this.pcs.keys()];
	}

	/** true once local media is open — i.e. we are actually in the call */
	get active(): boolean {
		return this.local !== null;
	}

	get stream(): MediaStream | null {
		return this.local;
	}

	async open(video: boolean): Promise<MediaStream> {
		if (this.local) return this.local;
		const get = this.o.getMedia ?? default_media;
		this.local = await get({ audio: true, video });
		return this.local;
	}

	/** tell every member we've joined; those already in the call will connect to us */
	announce(members: string[]): void {
		for (const uid of members) if (uid !== this.o.me) this.o.send(uid, { type: 'join' });
	}

	/** 1:1 caller — force an offer without waiting for the join/here handshake */
	async invite(uid: string): Promise<void> {
		await this.offer(uid);
	}

	/** 1:1 callee — answer an offer that was surfaced through onincoming */
	async accept(uid: string): Promise<void> {
		const sdp = this.pending.get(uid);
		if (!sdp) return;
		this.pending.delete(uid);
		await this.answer(uid, sdp);
	}

	async handle(from: string, s: CallSignal): Promise<void> {
		switch (s.type) {
			case 'join':
				if (!this.active || this.pcs.has(from)) return;
				if (this.o.me < from) await this.offer(from);
				else this.o.send(from, { type: 'here' });
				return;
			case 'here':
				// already connecting to this peer — join/here crossed in flight (both
				// joined near-simultaneously); a second offer would renegotiate a
				// connection that's already being set up
				if (!this.active || this.pcs.has(from)) return;
				if (this.o.me < from) await this.offer(from);
				return;
			case 'offer':
				if (this.o.onincoming && !this.active) {
					this.pending.set(from, s.sdp);
					this.o.onincoming(from, s.sdp);
					return;
				}
				if (!this.active) return; // room member who hasn't joined the call
				await this.answer(from, s.sdp);
				return;
			case 'answer':
				await this.pcs
					.get(from)
					?.setRemoteDescription(s.sdp)
					.catch(() => {});
				return;
			case 'ice':
				await this.pcs
					.get(from)
					?.addIceCandidate(s.candidate)
					.catch(() => {});
				return;
			case 'bye':
				this.drop(from);
				return;
		}
	}

	setMic(on: boolean): void {
		for (const t of this.local?.getAudioTracks() ?? []) t.enabled = on;
	}

	async setVideo(on: boolean): Promise<void> {
		if (!this.local) return;
		if (on) {
			const get = this.o.getMedia ?? default_media;
			const s = await get({ video: true });
			for (const t of s.getVideoTracks()) this.local.addTrack(t);
		} else {
			for (const t of this.local.getVideoTracks()) {
				t.stop();
				this.local.removeTrack(t);
			}
		}
		// a call that started audio-only has no video sender yet — replaceTrack only
		// works on a sender that already exists, so the first time video turns on we
		// must addTrack + renegotiate, not just swap an existing sender's track
		for (const [uid, pc] of this.pcs) {
			let needs_renegotiate = false;
			for (const t of this.local.getTracks()) {
				const sender = pc.getSenders().find((x) => x.track?.kind === t.kind);
				if (sender) {
					if (sender.track !== t) await sender.replaceTrack(t).catch(() => {});
				} else {
					pc.addTrack(t, this.local);
					needs_renegotiate = true;
				}
			}
			if (needs_renegotiate) await this.offer(uid);
		}
	}

	/** leave the call. `silent` skips the bye signals (socket already down). */
	hangup(silent = false): void {
		for (const uid of [...this.pcs.keys()]) {
			if (!silent) this.o.send(uid, { type: 'bye' });
			this.pcs.get(uid)?.close();
			this.pcs.delete(uid);
		}
		this.pending.clear();
		for (const t of this.local?.getTracks() ?? []) t.stop();
		this.local = null;
	}

	private drop(uid: string): void {
		this.pcs.get(uid)?.close();
		this.pcs.delete(uid);
		this.pending.delete(uid);
		this.o.onremote(uid, null);
	}

	private async pc(uid: string): Promise<RTCPeerConnection> {
		const existing = this.pcs.get(uid);
		if (existing) return existing;
		await this.ensureTurn();
		const iceServers = [STUN, ...this.turnServers];
		const pc = (this.o.makePC ?? (() => new RTCPeerConnection({ iceServers })))({ iceServers });
		pc.onicecandidate = (e) => {
			if (e.candidate) this.o.send(uid, { type: 'ice', candidate: e.candidate.toJSON() });
		};
		pc.ontrack = (e) => this.o.onremote(uid, e.streams[0]);
		pc.onconnectionstatechange = () => {
			// covers the peer vanishing without a bye (tab killed, network dropped).
			// 'disconnected' is routinely transient (a Wi-Fi hop, a few seconds of
			// packet loss) and ICE often recovers on its own — only drop on it if it
			// hasn't recovered after a grace period, so a blip doesn't eject someone
			// from the call outright.
			if (['failed', 'closed'].includes(pc.connectionState)) this.drop(uid);
			else if (pc.connectionState === 'disconnected') {
				setTimeout(() => {
					if (this.pcs.get(uid) === pc && pc.connectionState === 'disconnected') this.drop(uid);
				}, DISCONNECT_GRACE_MS);
			}
		};
		for (const t of this.local?.getTracks() ?? []) pc.addTrack(t, this.local!);
		this.pcs.set(uid, pc);
		return pc;
	}

	private async offer(uid: string): Promise<void> {
		const pc = await this.pc(uid);
		const o = await pc.createOffer();
		await pc.setLocalDescription(o);
		this.o.send(uid, { type: 'offer', sdp: o });
	}

	private async answer(uid: string, sdp: RTCSessionDescriptionInit): Promise<void> {
		const pc = await this.pc(uid);
		await pc.setRemoteDescription(sdp);
		const a = await pc.createAnswer();
		await pc.setLocalDescription(a);
		this.o.send(uid, { type: 'answer', sdp: a });
	}
}
