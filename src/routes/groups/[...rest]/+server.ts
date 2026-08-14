import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// permanent redirect for anything still pointing at the old groups URL space —
// push notifications already delivered to devices, browser bookmarks, and any installed
// PWA shortcut from a manifest fetched before the rooms rename all still carry it
export const GET: RequestHandler = ({ params }) => {
	throw redirect(308, params.rest ? `/~${params.rest}` : '/rooms');
};
