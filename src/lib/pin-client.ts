/** how long the app may sit in the background before it locks itself again */
export const HIDE_MS = 30_000;

/**
 * Relocks the app on the way out. The unlock cookie already dies when the browser or the
 * installed app closes, so this covers the two cases a cookie cannot: a tab left open in the
 * background, and a phone put down mid-thread. Both end with the server told to forget the
 * unlock, so nothing but the lock screen comes back.
 */
export function arm_lock(): () => void {
	let hidden_at = 0;

	const lock = () => navigator.sendBeacon('/api/pin/lock');

	const on_visibility = () => {
		if (document.visibilityState === 'hidden') {
			hidden_at = Date.now();
			return;
		}
		if (hidden_at && Date.now() - hidden_at > HIDE_MS) {
			lock();
			// full reload rather than a client navigation: the hook has to see the request and
			// send it to the lock screen, and every byte of thread already in this document
			// has to go with it
			location.reload();
		}
		hidden_at = 0;
	};

	document.addEventListener('visibilitychange', on_visibility);
	addEventListener('pagehide', lock);
	return () => {
		document.removeEventListener('visibilitychange', on_visibility);
		removeEventListener('pagehide', lock);
	};
}
