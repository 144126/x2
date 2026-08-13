export interface GeoResult {
	country: string;
	region: string;
	city: string;
}

export async function detect_location(): Promise<GeoResult | null> {
	if (typeof navigator === 'undefined') return null;

	if (navigator.permissions) {
		try {
			const perm = await navigator.permissions.query({ name: 'geolocation' });
			if (perm.state === 'denied') return null;
		} catch {}
	}

	return new Promise((resolve) => {
		navigator.geolocation.getCurrentPosition(
			async (pos) => {
				const { latitude, longitude } = pos.coords;
				try {
					const res = await fetch(
						`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`
					);
					if (!res.ok) {
						resolve(null);
						return;
					}
					const data = await res.json();
					if (!data.countryCode) {
						resolve(null);
						return;
					}
					resolve({
						country: data.countryCode as string,
						region: ((data.principalSubdivisionCode as string) ?? '').split('-')[1] ?? '',
						city: (data.city as string) ?? ''
					});
				} catch {
					resolve(null);
				}
			},
			() => resolve(null),
			{ timeout: 10_000, enableHighAccuracy: false }
		);
	});
}
