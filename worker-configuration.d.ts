interface Fetcher {
	fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface SecretVal {
	get?: () => Promise<string>;
}

interface RateLimit {
	limit(options: { key: string }): Promise<{ success: boolean }>;
}

// Minimal shape of the bits of R2 we use — hand-rolled like the rest of this file so the
// worker types don't collide with the DOM lib SvelteKit builds against.
interface MediaObject {
	body: ReadableStream;
	httpEtag: string;
	httpMetadata?: { contentType?: string; cacheControl?: string };
	/** used by the view-once path, which must hold the bytes before it deletes the object */
	arrayBuffer(): Promise<ArrayBuffer>;
	writeHttpMetadata(headers: Headers): void;
}

interface MediaBucket {
	put(
		key: string,
		value: ArrayBuffer,
		options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }
	): Promise<unknown>;
	get(key: string): Promise<MediaObject | null>;
	delete(key: string): Promise<void>;
}

interface Env {
	MEDIA: MediaBucket;
	QDRANT_URL: string | SecretVal;
	QDRANT_KEY: string | SecretVal;
	VOXELL_KEY?: string | SecretVal;
	SECRET: string | SecretVal;
	GOOGLE_ID: string | SecretVal;
	GOOGLE_SECRET: string | SecretVal;
	WS_ORIGIN?: string | SecretVal;
	X2_WS: Fetcher;
	PAYSTACK_SECRET_KEY_TEST?: string | SecretVal;
	PAYSTACK_SECRET_KEY_LIVE?: string | SecretVal;
	PAYSTACK_TEST?: string | SecretVal;
	PAYSTACK_BASE_URL?: string | SecretVal;
	GROQ?: string | SecretVal;
	OPENROUTER?: string | SecretVal;
	RL_SEND?: RateLimit;
	RL_UPLOAD?: RateLimit;
	RL_SEARCH?: RateLimit;
	RL_AI?: RateLimit;
}
