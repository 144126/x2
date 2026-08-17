export interface User {
	s: 'u';
	g: string; // external id (google sub or email)
	n?: string; // legacy display name; never render this as product identity
	p?: string; // picture
	m?: string; // email
	d: number; // created ts
	o?: 'google' | 'local' | 'device'; // provider — 'device' means created implicitly, no password or google link yet
	gl?: string; // linked google sub — set when a device/local account later links Google, distinct from g (fixed at creation, used to derive id)
	h?: string; // pw hash (local only)
	// app lock — see src/lib/server/pin.ts
	pn?: string; // pin hash, peppered with SECRET. presence is what turns the lock on
	pv?: number; // pin version — bumped on every set, change and clear, killing every unlock token
	pf?: number; // consecutive failed unlocks
	pl?: number; // locked out until this ts, after too many failures
	// profile
	u: string; // username (the only user-facing identity)
	a?: string; // about text
	i?: string[]; // interests (tokens)
	ag?: number; // age
	r?: string; // gender
	co?: string; // country iso code
	st?: string; // state iso code
	ci?: string; // city (free text)
	w?: string; // whatsapp number (subscriber number, stripped of country code / leading 0)
	tz?: string; // IANA timezone
	sp?: string[]; // own sticker pack — R2 media keys, newest first (see /api/stickers)
	hn?: string[]; // voice notes already heard, newest first — nothing is ever replayed
	mp?: 1; // show message previews on the chats page. off unless asked for
	// partner program
	ac?: string; // this user's own referral code, as a partner
	invited_by?: string; // uid of the partner whose code this user signed up under
}

export interface Message {
	s: 'm';
	id: string;
	c: string; // conversation id — `a|b` for 1:1, `g:<group id>` for a group
	f: string; // from uid
	t: string; // to uid ('' for group messages)
	gr?: string; // group id, when this is a group message
	rp?: string; // id of the message this one quotes
	rx?: Record<string, string[]>; // emoji -> uids who reacted
	sk?: string; // sticker id (static asset, see static/stickers/manifest.json) — when set, this message renders as a sticker, not text/image
	fw?: boolean; // true if this message was forwarded rather than composed fresh
	im?: string; // media key in R2, when an image is attached
	fl?: { key: string; name: string; size: number; type: string }; // non-image file attachment
	x: string; // text (may be empty when im or fl is set)
	d: number; // ts
	e?: number; // edited ts
	// view once — see src/lib/server/viewonce.ts. Content never rides in a thread payload:
	// it is handed out once per recipient by /api/messages/[id]/view and then destroyed.
	vo?: 1; // this message is view once
	vk?: MsgKind; // what kind it was, the only thing that survives the burn
	vw?: string[]; // recipients who have spent their one view
	vd?: number; // ts the content was destroyed, once every recipient had looked
	// deletion
	dl?: string[]; // uids who deleted this for themselves alone
	dx?: number; // ts deleted for everyone — content is gone, the tombstone stays
}

/** i=image, a=audio, f=file, s=sticker, t=text */
export type MsgKind = 'i' | 'a' | 'f' | 's' | 't';

export function msg_kind(m: Pick<Message, 'im' | 'fl' | 'sk'>): MsgKind {
	if (m.im) return 'i';
	if (m.fl) return m.fl.type.startsWith('audio/') ? 'a' : 'f';
	if (m.sk) return 's';
	return 't';
}

export const KIND_LABEL: Record<MsgKind, string> = {
	i: 'photo',
	a: 'voice note',
	f: 'file',
	s: 'sticker',
	t: 'message'
};

// records that two users were paired by random match, so the thread shows up
// in their conversation list even before either sends a message
export interface Match {
	s: 'x';
	f: string; // uid a
	t: string; // uid b
	d: number; // matched ts
}

export interface ScheduledMessage {
	s: 'sm';
	id: string;
	f: string; // sender uid
	to?: string; // recipient uid (1:1)
	group?: string; // group id (group send)
	text: string;
	image?: string;
	file?: { key: string; name: string; size: number; type: string };
	at: number; // unix ms when it should send
	sent: 0 | 1; // idempotency guard — 0 while pending, 1 once dispatched
}
