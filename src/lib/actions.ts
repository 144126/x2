/** Submit on Enter. Shift+Enter still makes a newline, and so does Enter mid-composition,
 *  or every accented character typed on a phone would send half a word. */
export function ctrlEnter(node: HTMLElement, submit: () => void) {
	let run = submit;
	const on = (e: KeyboardEvent) => {
		if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
		e.preventDefault();
		run();
	};
	node.addEventListener('keydown', on);
	return {
		update(next: () => void) {
			run = next;
		},
		destroy() {
			node.removeEventListener('keydown', on);
		}
	};
}
