import type { Component } from 'svelte';
import type { Message } from './types';
import { msg_kind, KIND_LABEL } from './types';

/** one row of a message's context menu — the caller decides which exist */
export type Item = { id: string; label: string; icon?: Component; danger?: boolean };

/** an attachment still on its way: uploading, sending, or stopped */
export type Up = {
	pct: number;
	st: 'u' | 's' | 'e';
	name: string;
	size: number;
	type: string;
	vo?: boolean;
};

/** one row in a thread — a stored message, or one that has not landed yet */
export type Row = Message & { cid?: string; err?: boolean; up?: Up };

export function pending(r: Row): boolean {
	return !!r.up && r.up.st !== 'e';
}

export function failed(r: Row): boolean {
	return !!r.err || r.up?.st === 'e';
}

export function deleted(r: Row): boolean {
	return !!r.dx;
}

/** the view is spent: either everyone has looked, or this reader already has */
export function burnt(r: Row, me: string): boolean {
	return !!r.vo && (!!r.vd || !!r.vw?.includes(me));
}

export function openable(r: Row, me: string): boolean {
	if (r.dx || pending(r) || failed(r)) return false;
	if (r.vo) return r.f !== me && !burnt(r, me);
	return !!r.im || !!r.fl;
}

export function human_size(bytes: number): string {
	if (bytes < 1024) return `${bytes}b`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}kb`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}mb`;
}

/** the chip text — a filename when there is one, otherwise what kind of thing it is */
export function label(r: Row, me: string): string {
	if (r.up) return r.up.name;
	if (r.vo) {
		const kind = KIND_LABEL[r.vk ?? 't'];
		return burnt(r, me) ? `${kind} · opened` : `view once ${kind}`;
	}
	if (r.fl) return r.fl.name;
	if (r.im) return 'photo';
	return KIND_LABEL[msg_kind(r)];
}

/** bytes to show beside the label, when the size is known */
export function size_of(r: Row): string {
	const bytes = r.up?.size ?? r.fl?.size;
	return bytes ? human_size(bytes) : '';
}

export function has_attachment(r: Row): boolean {
	return !!r.up || !!r.im || !!r.fl || !!r.vo;
}
