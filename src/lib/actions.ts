/** Submit on Ctrl/Cmd+Enter only. Plain Enter stays browser-default: a newline in a
 *  textarea, nothing in an input. Put it on the form or the field wrapper. */
export function ctrlEnter(node: HTMLElement, submit: () => void) {
	let run = submit;
	const on = (e: KeyboardEvent) => {
		if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
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
