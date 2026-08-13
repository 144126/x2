export function confirm_sent<T extends { cid?: string }>(
	messages: T[],
	cid: string,
	patch: Partial<T>
): T[] {
	return messages.map((m) => (m.cid === cid ? { ...m, ...patch } : m));
}

export function mark_failed<T extends { cid?: string; err?: boolean }>(
	messages: T[],
	cid: string
): T[] {
	return messages.map((m) => (m.cid === cid ? { ...m, err: true } : m));
}
