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
