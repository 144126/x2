type TzInput = { tz?: string; co?: string };

export async function resolve_tz(u: TzInput): Promise<string | undefined> {
	if (u.tz) return u.tz;
	if (!u.co) return undefined;
	const { Country } = await import('country-state-city');
	const c = Country.getCountryByCode(u.co);
	if (!c) return undefined;
	const zones: { zoneName: string }[] = c.timezones as { zoneName: string }[] | undefined;
	if (!zones || zones.length !== 1) return undefined;
	return zones[0].zoneName;
}

export function local_time(tz: string, ts: number): string {
	return new Intl.DateTimeFormat('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		timeZone: tz,
		hour12: false
	}).format(new Date(ts));
}
