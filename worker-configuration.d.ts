interface Fetcher {
	fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface SecretVal {
	get?: () => Promise<string>;
}

interface Env {
	QDRANT_URL: string | SecretVal;
	QDRANT_KEY: string | SecretVal;
	VOXELL_KEY?: string | SecretVal;
	SECRET: string | SecretVal;
	GOOGLE_ID: string | SecretVal;
	GOOGLE_SECRET: string | SecretVal;
	WS_ORIGIN?: string | SecretVal;
	X2_WS: Fetcher;
}
