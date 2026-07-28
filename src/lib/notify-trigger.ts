// Marks that the user has sent at least one message — the earliest sane moment to ask for
// notification permission (never on page load; a cold ask gets auto-denied by browsers).
const KEY = 'x2:has-sent';

export function mark_first_send(): void {
	try {
		localStorage.setItem(KEY, '1');
	} catch {
		/* private browsing */
	}
}

export function has_sent(): boolean {
	try {
		return localStorage.getItem(KEY) === '1';
	} catch {
		return false;
	}
}
