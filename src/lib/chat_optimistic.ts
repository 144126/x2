export function confirm_sent<T extends { cid?: string }>(
	messages: T[],
	cid: string,
	patch: Partial<T>
): T[] {
	// undefined keys are dropped rather than spread: the send response deliberately echoes no
	// content back, and a plain spread would overwrite the row's own sticker or text with it
	const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
	return messages.map((m) => (m.cid === cid ? { ...m, ...set } : m));
}

export function mark_failed<T extends { cid?: string; err?: boolean }>(
	messages: T[],
	cid: string
): T[] {
	return messages.map((m) => (m.cid === cid ? { ...m, err: true } : m));
}
