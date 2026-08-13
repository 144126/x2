/** short wall clock for a message row, e.g. "9:41 pm" */
export function clock(ts: number): string {
	return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

/** the separator a thread shows above the first message of each day */
export function day_label(ts: number, now = Date.now()): string {
	const d = new Date(ts);
	const days = Math.round(
		(new Date(now).setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) / 86_400_000
	);
	if (days === 0) return 'today';
	if (days === 1) return 'yesterday';
	if (days < 7 && days > 0) return d.toLocaleDateString([], { weekday: 'long' }).toLowerCase();
	return d
		.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
		.toLowerCase();
}
