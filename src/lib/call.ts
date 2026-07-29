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
	makePC?: () => RTCPeerConnection;
	getMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
};

// ponytail: free Google STUN only — add TURN for symmetric NATs in prod
const STUN: RTCIceServer = { urls: 'stun:stun.l.google.com:19302' };

export class CallMesh {
	private o: MeshOpts;
	private pcs = new Map<string, RTCPeerConnection>();
	private pending = new Map<string, RTCSessionDescriptionInit>();
	private local: MediaStream | null = null;

	constructor(opts: MeshOpts) {
		this.o = opts;
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
		const get = this.o.getMedia ?? ((c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c));
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
				if (!this.active) return;
				if (this.o.me < from) await this.offer(from);
				else this.o.send(from, { type: 'here' });
				return;
			case 'here':
				if (!this.active) return;
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
				await this.pcs.get(from)?.setRemoteDescription(s.sdp).catch(() => {});
				return;
			case 'ice':
				await this.pcs.get(from)?.addIceCandidate(s.candidate).catch(() => {});
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
			const get = this.o.getMedia ?? ((c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c));
			const s = await get({ video: true });
			for (const t of s.getVideoTracks()) this.local.addTrack(t);
		} else {
			for (const t of this.local.getVideoTracks()) {
				t.stop();
				this.local.removeTrack(t);
			}
		}
		// re-point every existing sender at the current track set
		for (const pc of this.pcs.values()) {
			for (const t of this.local.getTracks()) {
				const sender = pc.getSenders().find((x) => x.track?.kind === t.kind);
				if (sender) await sender.replaceTrack(t).catch(() => {});
			}
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

	private pc(uid: string): RTCPeerConnection {
		const existing = this.pcs.get(uid);
		if (existing) return existing;
		const pc = (this.o.makePC ?? (() => new RTCPeerConnection({ iceServers: [STUN] })))();
		pc.onicecandidate = (e) => {
			if (e.candidate) this.o.send(uid, { type: 'ice', candidate: e.candidate.toJSON() });
		};
		pc.ontrack = (e) => this.o.onremote(uid, e.streams[0]);
		pc.onconnectionstatechange = () => {
			// covers the peer vanishing without a bye (tab killed, network dropped)
			if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) this.drop(uid);
		};
		for (const t of this.local?.getTracks() ?? []) pc.addTrack(t, this.local!);
		this.pcs.set(uid, pc);
		return pc;
	}

	private async offer(uid: string): Promise<void> {
		const pc = this.pc(uid);
		const o = await pc.createOffer();
		await pc.setLocalDescription(o);
		this.o.send(uid, { type: 'offer', sdp: o });
	}

	private async answer(uid: string, sdp: RTCSessionDescriptionInit): Promise<void> {
		const pc = this.pc(uid);
		await pc.setRemoteDescription(sdp);
		const a = await pc.createAnswer();
		await pc.setLocalDescription(a);
		this.o.send(uid, { type: 'answer', sdp: a });
	}
}
