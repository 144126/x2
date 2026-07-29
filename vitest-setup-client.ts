import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';

afterEach(() => cleanup());

// jsdom doesn't implement <dialog>'s imperative API — polyfill just enough for
// showModal()/close() to toggle the `open` attribute and fire `close`, which is all any
// component here relies on.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
		this.setAttribute('open', '');
	};
	HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
		const wasOpen = this.open;
		this.removeAttribute('open');
		if (wasOpen) this.dispatchEvent(new Event('close'));
	};
}
