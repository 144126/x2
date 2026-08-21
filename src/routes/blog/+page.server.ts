import { posts } from '$lib/blog';

export const load = ({ url }) => {
	return {
		origin: url.origin,
		posts: posts.map((p) => ({
			slug: p.slug,
			title: p.title,
			description: p.description,
			date: p.date,
			tags: p.tags
		}))
	};
};
