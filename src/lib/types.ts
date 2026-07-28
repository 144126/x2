export interface User {
	s: 'u';
	g: string; // external id (google sub or email)
	n?: string; // legacy display name; never render this as product identity
	p?: string; // picture
	m?: string; // email
	d: number; // created ts
	o?: 'google' | 'local'; // provider
	h?: string; // pw hash (local only)
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
}

export interface Message {
	s: 'm';
	id: string;
	c: string; // conversation id — `a|b` for 1:1, `g:<group id>` for a group
	f: string; // from uid
	t: string; // to uid ('' for group messages)
	gr?: string; // group id, when this is a group message
	im?: string; // media key in R2, when an image is attached
	x: string; // text (may be empty when im is set)
	d: number; // ts
}

// records that two users were paired by random match, so the thread shows up
// in their conversation list even before either sends a message
export interface Match {
	s: 'x';
	f: string; // uid a
	t: string; // uid b
	d: number; // matched ts
}
