export interface User {
	s: 'u';
	g: string; // external id (google sub or email)
	n: string; // display name
	p?: string; // picture
	m?: string; // email
	d: number; // created ts
	o?: 'google' | 'local'; // provider
	h?: string; // pw hash (local only)
	// profile
	u?: string; // username
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
	c: string; // conversation id
	f: string; // from uid
	t: string; // to uid
	x: string; // text
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
