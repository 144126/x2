/// <reference path="../worker-configuration.d.ts" />
// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}

		interface Geo {
			country: string | null;
			region: string | null;
			region_name: string | null;
			city: string | null;
			tz: string | null;
		}

		interface PageState {
			modal?: 'create-room' | 'edit-room';
		}

interface Locals {
		user?: { id: string; username: string; picture?: string; email?: string; is_device?: boolean } | null;
		device_id?: string;
		x2_ws: Fetcher;
		geo: Geo | null;
		/**
		 * Keep a promise alive past the response. Backed by ExecutionContext.waitUntil in
		 * production; falls back to a floating promise (dev/test/prerender) where the isolate
		 * is not torn down at response time.
		 */
		bg: (p: Promise<unknown>) => void;
	}
	}
}

export {};
