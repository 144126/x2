import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// /app bought nothing — no layout, no auth boundary, no manifest scope — so every page under
// it moved up a level. Delivered push notifications, bookmarks, and installed PWA shortcuts
// still carry the old prefix, and the share target is a POST, which a 308 keeps intact.
const MOVED: Record<string, string> = { '': '/find', user: '/user' };

export const GET: RequestHandler = ({ params, url }) => {
	const [head, ...rest] = (params.rest ?? '').split('/');
	throw redirect(308, [MOVED[head] ?? `/${head}`, ...rest].join('/') + url.search);
};

export const POST = GET;
