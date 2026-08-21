import { error } from '@sveltejs/kit';
import { posts } from '$lib/blog';

export const load = ({ params, url }) => {
	const post = posts.find((p) => p.slug === params.slug);
	if (!post) throw error(404, 'not found');
	return { post, origin: url.origin };
};
