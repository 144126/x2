import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// rooms moved to /~handle; /rooms is still where you browse them
export const GET: RequestHandler = ({ params }) => {
	throw redirect(308, `/~${params.id}`);
};
