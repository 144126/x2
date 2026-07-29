import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// permanent redirect for anything still pointing at the old /app/groups URL space —
// push notifications already delivered to devices, browser bookmarks, and any installed
// PWA shortcut from a manifest fetched before the /app/rooms rename all still carry it
export const GET: RequestHandler = ({ params }) => {
	throw redirect(308, params.rest ? `/app/rooms/${params.rest}` : '/app/rooms');
};
